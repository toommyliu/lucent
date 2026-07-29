import { toMonsterSelector } from "@lucent/game";
import type { MonsterQuery } from "@lucent/game";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { BridgeService } from "../bridge/Bridge";
import { UnknownRecord } from "../contract/Coercion";
import { MonsterPayload, toMonster } from "../contract/payload/World";
import type { Store } from "../state/Store";

const NestedMonster = Schema.Struct({
  dataLeaf: UnknownRecord,
  objData: Schema.optionalKey(UnknownRecord),
});
const NullableMonster = Schema.NullOr(
  Schema.Union([MonsterPayload, NestedMonster]),
);
const decodeMonster = Schema.decodeUnknownOption(MonsterPayload);

export const makeMonsters = (bridge: BridgeService, store: Store) => {
  const get = (selector: MonsterQuery) => {
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

  const getAll = () => store.world.getMonsters;
  const getAvailable = () =>
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
  const isAvailable = (selector: MonsterQuery) =>
    get(selector).pipe(
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
    get,
    getAll,
    getAvailable,
    isAvailable,
  };
};

export type Monsters = ReturnType<typeof makeMonsters>;
