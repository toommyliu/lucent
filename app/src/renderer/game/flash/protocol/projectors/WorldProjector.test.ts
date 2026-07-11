import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { EntityState, LiveAura } from "@lucent/game";
import type { AuthApiShape } from "../../api/Auth";
import type { FlashPacket } from "../../Types";
import { WorldState, layer as WorldStateLayer } from "../../state/World";
import { makeTargetRelations } from "./TargetRelations";
import { projectWorldPacket } from "./WorldProjector";

const auth = (username = "Hero"): AuthApiShape => ({
  connectTo: () =>
    Effect.succeed({
      message: "connected",
      retryable: false,
      status: "connected",
    }),
  getPassword: () => Effect.succeed(""),
  getServers: () => Effect.succeed([]),
  getUsername: () => Effect.succeed(username),
  isLoggedIn: () => Effect.succeed(true),
  isServerSelectReady: () => Effect.succeed(true),
  isTemporarilyKicked: () => Effect.succeed(false),
  login: () => Effect.succeed(true),
  logout: () => Effect.void,
});

const extensionPacket = (
  command: string,
  data: unknown,
  wireType: FlashPacket["wireType"] = "json",
): FlashPacket => ({
  command,
  data,
  direction: "extension",
  raw: "",
  wireType,
});

const clientPacket = (
  command: string,
  params: readonly string[],
): FlashPacket => ({
  command,
  direction: "client",
  params,
  raw: "",
  wireType: "str",
});

const player = (
  entityId: number,
  username: string,
  overrides: Record<string, unknown> = {},
) => ({
  entID: entityId,
  intHP: 100,
  intHPMax: 100,
  intLevel: 1,
  intMP: 50,
  intMPMax: 50,
  intState: EntityState.Idle,
  strFrame: "Enter",
  strPad: "Spawn",
  strUsername: username,
  tx: 0,
  ty: 0,
  uoName: username,
  ...overrides,
});

const monster = (
  monsterMapId: number,
  name: string,
  overrides: Record<string, unknown> = {},
) => ({
  MonID: monsterMapId,
  MonMapID: monsterMapId,
  intHP: 100,
  intHPMax: 100,
  intMP: 30,
  intMPMax: 30,
  intState: EntityState.Idle,
  strFrame: "r1",
  strMonName: name,
  ...overrides,
});

const areaPacket = (
  players = [player(1, "Hero")],
  monsters = [monster(7, "Training Dummy")],
) =>
  extensionPacket("moveToArea", {
    areaId: 1,
    areaName: "battleon-1001",
    monBranch: monsters,
    mondef: [],
    monmap: [],
    uoBranch: players,
  });

describe("World projector", () => {
  it.effect(
    "reconciles authoritative area snapshots without replacing entities",
    () =>
      Effect.gen(function* () {
        const world = yield* WorldState;
        const relations = makeTargetRelations();
        yield* projectWorldPacket(areaPacket(), auth(), world, relations);
        const hero = yield* world.getMe();
        const target = yield* world.getMonster(7);
        expect(hero?.username).toBe("Hero");

        yield* world.addAura(
          "player",
          1,
          new LiveAura({
            duration: 5,
            kind: "active",
            name: "Focus",
            stack: 1,
          }),
        );
        yield* world.addAura(
          "monster",
          7,
          new LiveAura({
            duration: 5,
            kind: "active",
            name: "Guard",
            stack: 1,
          }),
        );
        yield* projectWorldPacket(
          areaPacket(
            [player(1, "Hero", { intHP: 75, strFrame: "r3" })],
            [monster(7, "Training Dummy", { intHP: 60, strFrame: "branch-b" })],
          ),
          auth(),
          world,
          relations,
        );

        expect(yield* world.getMe()).toBe(hero);
        expect(yield* world.getMonster(7)).toBe(target);
        expect((yield* world.getMe())?.hp).toBe(75);
        expect((yield* world.getMonster(7))?.cell).toBe("branch-b");
        expect(yield* world.getPlayerAuras(1)).toEqual([]);
        expect(yield* world.getMonsterAuras(7)).toEqual([]);
      }).pipe(Effect.provide(WorldStateLayer)),
  );

  it.effect(
    "registers sparse identities and rejects unidentified live updates",
    () =>
      Effect.gen(function* () {
        const world = yield* WorldState;
        const relations = makeTargetRelations();
        yield* projectWorldPacket(
          areaPacket([player(1, "Hero", { intHP: 75, strFrame: "r3" })], []),
          auth(),
          world,
          relations,
        );
        const hero = yield* world.getMe();

        yield* projectWorldPacket(
          extensionPacket("initUserData", {
            data: player(0, "Hero", {
              entID: undefined,
              intHP: 0,
              strFrame: "Wrong",
            }),
            uid: 42,
          }),
          auth(),
          world,
          relations,
        );
        expect(yield* world.getMe()).toBe(hero);
        expect((yield* world.getMe())?.entityId).toBe(42);
        expect((yield* world.getMe())?.hp).toBe(75);
        expect((yield* world.getMe())?.cell).toBe("r3");

        yield* projectWorldPacket(
          extensionPacket("uotls", {
            o: { afk: true, strFrame: "r2", tx: 1, ty: 2 },
            unm: "Ghost",
          }),
          auth(),
          world,
          relations,
        );
        expect(yield* world.getPlayer("Ghost")).toBeNull();

        yield* projectWorldPacket(
          extensionPacket("uotls", {
            o: {
              afk: true,
              entID: 9,
              strFrame: "r2",
              strPad: "Left",
              tx: 5,
              ty: 6,
              uoName: "Ghost",
            },
            unm: "Ghost",
          }),
          auth(),
          world,
          relations,
        );
        expect((yield* world.getPlayer(9))?.position).toEqual({ x: 5, y: 6 });
      }).pipe(Effect.provide(WorldStateLayer)),
  );

  it.effect(
    "projects string updates, respawns, local movement, and death transitions",
    () =>
      Effect.gen(function* () {
        const world = yield* WorldState;
        const relations = makeTargetRelations();
        yield* projectWorldPacket(
          areaPacket(undefined, [monster(7, "One"), monster(8, "Two")]),
          auth(),
          world,
          relations,
        );

        const firstDeath = yield* projectWorldPacket(
          extensionPacket(
            "mtls",
            ["mtls", "unused", "7", "intHP:-2,intMP:0,intState:0"],
            "str",
          ),
          auth(),
          world,
          relations,
        );
        expect(firstDeath.map((event) => event.type)).toEqual(["monsterDeath"]);

        const repeatedDeath = yield* projectWorldPacket(
          extensionPacket(
            "mtls",
            ["mtls", "unused", "7", "intHP:0,intMP:0,intState:0"],
            "str",
          ),
          auth(),
          world,
          relations,
        );
        expect(repeatedDeath).toEqual([]);

        yield* projectWorldPacket(
          extensionPacket(
            "mtls",
            ["mtls", "unused", "8", "intHP:0,intMP:0,intState:0"],
            "str",
          ),
          auth(),
          world,
          relations,
        );
        yield* projectWorldPacket(
          extensionPacket("respawnMon", ["respawnMon", "unused", "7,8"], "str"),
          auth(),
          world,
          relations,
        );
        for (const id of [7, 8]) {
          const entity = yield* world.getMonster(id);
          expect(entity?.hp).toBe(entity?.maxHp);
          expect(entity?.state).toBe(EntityState.Idle);
        }

        yield* projectWorldPacket(
          clientPacket("mv", ["xt", "zm", "mv", "1", "880", "249", "8"]),
          auth(),
          world,
          relations,
        );
        expect((yield* world.getMe())?.position).toEqual({ x: 880, y: 249 });
      }).pipe(Effect.provide(WorldStateLayer)),
  );
});
