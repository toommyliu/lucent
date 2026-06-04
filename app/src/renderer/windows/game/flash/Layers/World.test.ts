import { EntityState, type AvatarData, type MonsterData } from "@lucent/game";
import { Effect, Layer, Option } from "effect";
import { expect, test } from "vitest";
import { Bridge, type BridgeShape } from "../Services/Bridge";
import { Wait, type WaitShape } from "../Services/Wait";
import { World } from "../Services/World";
import { WorldLive } from "./World";

const wait = {
  until: (condition) => condition,
  untilSome: (condition) => condition,
  isGameActionAvailable: () => Effect.succeed(true),
  forGameAction: () => Effect.succeed(true),
} as WaitShape;

const avatarData = (
  username: string,
  entId: number,
  cell = "Enter",
): AvatarData => ({
  afk: false,
  entID: entId,
  entType: "player",
  intHP: 100,
  intHPMax: 100,
  intLevel: 100,
  intMP: 100,
  intMPMax: 100,
  intState: EntityState.Idle,
  strFrame: cell,
  strPad: "Spawn",
  strUsername: username,
  tx: 0,
  ty: 0,
  uoName: username.toLowerCase(),
});

const monsterData = (
  monMapId: number,
  name: string,
  cell = "Enter",
): MonsterData => ({
  iLvl: 1,
  intHP: 100,
  intHPMax: 100,
  intMP: 100,
  intMPMax: 100,
  intState: EntityState.Idle,
  monId: monMapId,
  monMapId,
  sRace: "None",
  strFrame: cell,
  strMonName: name,
});

const withWorld = <A>(
  bridge: BridgeShape,
  effect: Effect.Effect<A, unknown, World>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        WorldLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Bridge)(bridge),
              Layer.succeed(Wait)(wait),
            ),
          ),
        ),
      ),
    ),
  );

test("player selectors support username, entId, both-match, and getMe", async () => {
  const bridge = {
    call() {
      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withWorld(
    bridge,
    Effect.gen(function* () {
      const world = yield* World;
      yield* world.players.add(avatarData("Main", 1));
      yield* world.players.add(avatarData("Alt", 2));
      yield* world.players.setSelf("Main");

      return {
        byUsername: yield* world.players.get("main"),
        byEntId: yield* world.players.get(2),
        bothMatch: yield* world.players.get({ username: "Alt", entId: 2 }),
        bothMismatch: yield* world.players.get({ username: "Alt", entId: 1 }),
        me: yield* world.players.getSelf(),
      };
    }),
  );

  expect(Option.isSome(result.byUsername)).toBe(true);
  expect(Option.isSome(result.byEntId)).toBe(true);
  expect(Option.isSome(result.bothMatch)).toBe(true);
  expect(Option.isNone(result.bothMismatch)).toBe(true);
  expect(Option.isSome(result.me) ? result.me.value.username : null).toBe(
    "Main",
  );
});

test("monster selectors resolve first matching name and precise monMapId", async () => {
  const bridge = {
    call() {
      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withWorld(
    bridge,
    Effect.gen(function* () {
      const world = yield* World;
      yield* world.monsters.add(monsterData(7, "Ultra Boss"));
      yield* world.monsters.add(monsterData(8, "Ultra Boss"));

      return {
        byName: yield* world.monsters.get({ name: "Ultra" }),
        byId: yield* world.monsters.get({ monMapId: 8, name: "Ultra Boss" }),
        mismatch: yield* world.monsters.get({
          monMapId: 8,
          name: "Missing",
        }),
      };
    }),
  );

  expect(Option.isSome(result.byName) ? result.byName.value.monMapId : null).toBe(
    7,
  );
  expect(Option.isSome(result.byId) ? result.byId.value.monMapId : null).toBe(8);
  expect(Option.isNone(result.mismatch)).toBe(true);
});

test("available monsters use native bridge ids and aura has checks min stacks", async () => {
  const availabilityChecks: number[] = [];
  const bridge = {
    call(path, args) {
      if (path === "world.getAvailableMonsterMapIds") {
        return Effect.succeed([8, 999]) as never;
      }

      if (path === "world.isMonsterAvailable") {
        availabilityChecks.push(Number(args?.[0]));
        return Effect.succeed(args?.[0] === 8) as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withWorld(
    bridge,
    Effect.gen(function* () {
      const world = yield* World;
      yield* world.players.add(avatarData("Main", 1));
      yield* world.monsters.add(monsterData(7, "Ultra Boss"));
      yield* world.monsters.add(monsterData(8, "Other Boss"));
      yield* world.players.addAura(1, { name: "Arcane Shield", stack: 2 });
      yield* world.monsters.addAura(8, { name: "Enrage", stack: 3 });

      const available = yield* world.monsters.getAvailable();

      return {
        availableIds: Array.from(available.keys()),
        firstIsAvailable: yield* world.monsters.isAvailable({
          name: "Other",
        }),
        playerAuraAtLeastTwo: yield* world.players.auras.has(
          "Main",
          "Arcane Shield",
          2,
        ),
        playerAuraAtLeastThree: yield* world.players.auras.has(
          "Main",
          "Arcane Shield",
          3,
        ),
        monsterAuraAtLeastThree: yield* world.monsters.auras.has(
          8,
          "Enrage",
          3,
        ),
      };
    }),
  );

  expect(result.availableIds).toEqual([8]);
  expect(result.firstIsAvailable).toBe(true);
  expect(availabilityChecks).toEqual([8]);
  expect(result.playerAuraAtLeastTwo).toBe(true);
  expect(result.playerAuraAtLeastThree).toBe(false);
  expect(result.monsterAuraAtLeastThree).toBe(true);
});
