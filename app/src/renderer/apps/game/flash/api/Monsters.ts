import { toMonsterSelector } from "@lucent/game";
import type { LiveMonster, MonsterQuery } from "@lucent/game";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { BridgeService } from "../bridge/Bridge";
import { UnknownRecord } from "../contract/Coercion";
import { packetData } from "../contract/Packet";
import { decodeMonsterDrops } from "../contract/payload/MonsterDrops";
import { MonsterPayload, toMonster } from "../contract/payload/World";
import type { Store } from "../state/Store";
import type { Events } from "./Events";
import type { Wait } from "./Wait";

const NestedMonster = Schema.Struct({
  dataLeaf: UnknownRecord,
  objData: Schema.optionalKey(UnknownRecord),
});
const NullableMonster = Schema.NullOr(
  Schema.Union([MonsterPayload, NestedMonster]),
);
const decodeMonster = Schema.decodeUnknownOption(MonsterPayload);

const monsterDropRequestSpacing = Schedule.spaced("350 millis").pipe(
  Schedule.jittered,
);

interface MonsterDropRequest {
  readonly done: Deferred.Deferred<void>;
  readonly key: string;
  readonly monsterMapId: number;
}

export const makeMonsters = Effect.fnUntraced(function* (
  bridge: BridgeService,
  store: Store,
  events: Events,
  wait: Wait,
) {
  const requests = yield* Queue.unbounded<MonsterDropRequest>();
  const inFlight = new Map<string, Deferred.Deferred<void>>();

  yield* Effect.addFinalizer(() => Queue.shutdown(requests));

  const requestKey = Effect.fn("Monsters.requestKey")(function* (
    monsterMapId: number,
  ) {
    const map = yield* store.world.getMap;
    return `${map.id}:${map.name}:${map.roomNumber}:${monsterMapId}`;
  });

  const isInCurrentCell = Effect.fn("Monsters.isInCurrentCell")(function* (
    monster: LiveMonster,
  ) {
    const player = yield* store.world.getMe;
    return player !== null && monster.isInCell(player.cell);
  });

  const executeRequest = Effect.fn("Monsters.executeDropRequest")(function* (
    request: MonsterDropRequest,
  ) {
    const operation = Effect.gen(function* () {
      if ((yield* requestKey(request.monsterMapId)) !== request.key) return;
      if ((yield* store.world.getMonsterDrops(request.monsterMapId)) !== null)
        return;

      const monster = yield* store.world.getMonster(request.monsterMapId);
      if (monster === null || !(yield* isInCurrentCell(monster))) return;

      yield* wait.forPacket(
        {
          command: "monsterDrops",
          direction: "extension",
          predicate: (packet) => {
            const decoded = decodeMonsterDrops(packetData(packet));
            return (
              Option.isSome(decoded) &&
              decoded.value.MonMapID === request.monsterMapId
            );
          },
          encoding: "json",
        },
        {
          timeout: "3 seconds",
          trigger: bridge
            .invoke(
              "world.requestMonsterDrops",
              [request.monsterMapId],
              Schema.Boolean,
            )
            .pipe(Effect.map(Option.getOrElse(() => false))),
        },
      );
    });

    yield* operation.pipe(
      Effect.ensuring(
        Deferred.succeed(request.done, undefined).pipe(
          Effect.andThen(
            Effect.sync(() => {
              if (inFlight.get(request.key) === request.done) {
                inFlight.delete(request.key);
              }
            }),
          ),
          Effect.asVoid,
        ),
      ),
    );
  });

  // Pace every native request through one queue while response waits overlap.
  yield* Stream.fromQueue(requests).pipe(
    Stream.schedule(monsterDropRequestSpacing),
    Stream.mapEffect((request) => executeRequest(request), {
      concurrency: "unbounded",
    }),
    Stream.runDrain,
    Effect.forkScoped,
  );

  const ensureDrops = Effect.fn("Monsters.ensureDrops")(function* (
    monster: LiveMonster,
  ) {
    if ((yield* store.world.getMonsterDrops(monster.monsterMapId)) !== null)
      return;
    if (!(yield* isInCurrentCell(monster))) return;

    const key = yield* requestKey(monster.monsterMapId);
    const active = inFlight.get(key);
    if (active !== undefined) {
      yield* Deferred.await(active);
      return;
    }

    const done = Deferred.makeUnsafe<void>();
    inFlight.set(key, done);
    yield* Queue.offer(requests, {
      done,
      key,
      monsterMapId: monster.monsterMapId,
    });
    yield* Deferred.await(done);
  });

  const ensureAllDrops = (monsters: readonly LiveMonster[]) =>
    Effect.forEach(monsters, ensureDrops, {
      concurrency: "unbounded",
      discard: true,
    });

  const getProjected = (selector: MonsterQuery) => {
    return store.world.getMonster(selector).pipe(
      Effect.flatMap((current) =>
        current !== null
          ? Effect.succeed(current)
          : bridge
              .invoke(
                "world.getMonster",
                [toMonsterSelector(selector)],
                NullableMonster,
              )
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.succeed(null),
                    onSome: (payload) => {
                      if (payload === null) return Effect.succeed(null);
                      const decoded =
                        "dataLeaf" in payload
                          ? decodeMonster({
                              ...payload.objData,
                              ...payload.dataLeaf,
                            })
                          : Option.some(payload);
                      return Option.isNone(decoded)
                        ? Effect.succeed(null)
                        : store.world.putMonster(toMonster(decoded.value));
                    },
                  }),
                ),
              ),
      ),
    );
  };

  const getAllProjected = () => store.world.getMonsters;
  const getAvailableProjected = () =>
    bridge
      .invoke(
        "world.getAvailableMonsterMapIds",
        undefined,
        Schema.Array(Schema.Number),
      )
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed([]),
            onSome: (ids) =>
              store.world.getMonsters.pipe(
                Effect.map((monsters) => {
                  const available = new Set(ids);
                  return monsters.filter((monster) =>
                    available.has(monster.monsterMapId),
                  );
                }),
              ),
          }),
        ),
      );

  const ensureCurrentCell = Effect.fn("Monsters.ensureCurrentCell")(function* (
    monsters: readonly LiveMonster[],
  ) {
    const player = yield* store.world.getMe;
    if (player === null) return;
    yield* ensureAllDrops(
      monsters.filter((monster) => monster.isInCell(player.cell)),
    );
  });

  yield* events.on({ type: "join-map" }, () =>
    getAllProjected().pipe(Effect.flatMap(ensureCurrentCell)),
  );
  yield* events.on({ type: "player-location" }, (event) =>
    store.world.getMe.pipe(
      Effect.flatMap((player) =>
        player?.entityId === event.entityId
          ? getAllProjected().pipe(Effect.flatMap(ensureCurrentCell))
          : Effect.void,
      ),
    ),
  );

  const get = (selector: MonsterQuery) =>
    getProjected(selector).pipe(
      Effect.tap((monster) =>
        monster === null ? Effect.void : ensureDrops(monster),
      ),
    );
  const getAll = () =>
    getAllProjected().pipe(
      Effect.tap(ensureCurrentCell),
      Effect.map((monsters) => [...monsters]),
    );
  const getAvailable = () =>
    getAvailableProjected().pipe(
      Effect.tap(ensureAllDrops),
      Effect.map((monsters) => [...monsters]),
    );
  const isAvailable = (selector: MonsterQuery) =>
    getProjected(selector).pipe(
      Effect.flatMap((monster) =>
        monster === null
          ? Effect.succeed(false)
          : bridge
              .invoke(
                "world.isMonsterAvailable",
                [monster.monsterMapId],
                Schema.Boolean,
              )
              .pipe(Effect.map(Option.getOrElse(() => false))),
      ),
    );

  return {
    api: {
      get,
      getAll,
      getAvailable,
      isAvailable,
    },
    lookup: {
      get: getProjected,
      getAll: getAllProjected,
      getAvailable: getAvailableProjected,
    },
  };
});

export type MonsterServices = Effect.Success<ReturnType<typeof makeMonsters>>;
export type MonsterLookup = MonsterServices["lookup"];
export type Monsters = MonsterServices["api"];
