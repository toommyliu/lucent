import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, PubSub, Ref } from "effect";
import { EntityState, LiveAura, LiveMonster, LivePlayer } from "@lucent/game";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import { AuthApi, type AuthApiShape } from "../api/Auth";
import type { FlashCallback } from "../FlashCallbacks";
import { FlashCallbacks } from "../FlashCallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import type { FlashEvent } from "../Types";
import { layer as DropsStateLayer } from "../state/Drops";
import { layer as ItemsStateLayer } from "../state/Items";
import { layer as QuestsStateLayer } from "../state/Quests";
import { layer as ShopsStateLayer } from "../state/Shops";
import { WorldState, layer as WorldStateLayer } from "../state/World";
import { FlashProtocol, layer as FlashProtocolLayer } from "./FlashProtocol";
import { layer as ProjectorsLayer } from "./Projectors";

const flushProjection = Effect.gen(function* () {
  yield* Effect.yieldNow;
  yield* Effect.yieldNow;
  yield* Effect.yieldNow;
});

const makeHarness = (username = "Hero") =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<FlashCallback>();
    const publish = (event: FlashCallback) =>
      Effect.gen(function* () {
        yield* PubSub.publish(pubsub, event);
        yield* flushProjection;
      });

    const callbacks = FlashCallbacks.of({
      publish,
      subscribe: () => PubSub.subscribe(pubsub),
    });

    const bridge = SwfBridge.of({
      call: ((method) =>
        Effect.succeed(bridgeFallbacks[method]())) as SwfBridgeShape["call"],
      callGameFunction: () => Effect.succeed(null),
      readJson: () => Effect.succeed(null),
    });

    const auth = AuthApi.of({
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
    } satisfies AuthApiShape);

    const base = Layer.mergeAll(
      Layer.succeed(FlashCallbacks, callbacks),
      Layer.succeed(SwfBridge, bridge),
      Layer.succeed(AuthApi, auth),
      DropsStateLayer,
      ItemsStateLayer,
      QuestsStateLayer,
      ShopsStateLayer,
      WorldStateLayer,
    );
    const protocol = FlashProtocolLayer.pipe(Layer.provideMerge(base));

    return {
      layer: ProjectorsLayer.pipe(
        Layer.provideMerge(Layer.mergeAll(base, protocol)),
      ),
      publish,
    };
  });

const extensionJson = (
  command: string,
  data: Record<string, unknown> = {},
): FlashCallback => ({
  raw: JSON.stringify({ dataObj: { cmd: command, ...data }, type: "json" }),
  type: "extension-packet",
});

const extensionStr = (
  command: string,
  data: readonly unknown[],
): FlashCallback => ({
  raw: JSON.stringify({ dataObj: [command, ...data], type: "str" }),
  type: "extension-packet",
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
  intState: 1,
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
  intState: 1,
  strFrame: "r1",
  strMonName: name,
  ...overrides,
});

describe("Flash packet projectors", () => {
  it.effect("projects client movement only from client string packets", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const world = yield* WorldState;
          yield* world.addPlayer(
            new LivePlayer({
              afk: false,
              cell: "Enter",
              entityId: 1,
              entityType: "player",
              hp: 100,
              level: 1,
              maxHp: 100,
              maxMp: 50,
              mp: 50,
              name: "Hero",
              pad: "Spawn",
              position: { x: 0, y: 0 },
              state: EntityState.Idle,
              username: "Hero",
            }),
          );
          yield* world.setSelf("Hero");

          yield* harness.publish(extensionStr("mv", ["zm", "mv", 1, 777, 888]));
          expect((yield* world.getMe())?.position).toEqual({ x: 0, y: 0 });

          yield* harness.publish({
            raw: "[Sending - STR]: %xt%zm%mv%96180%880%249%8%",
            type: "client-packet",
          });
          expect((yield* world.getMe())?.position).toEqual({ x: 880, y: 249 });
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("projects json and string uotls independently", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          const world = yield* WorldState;
          yield* harness.publish(
            extensionJson("moveToArea", {
              areaId: 1,
              areaName: "battleon-1001",
              monBranch: [],
              mondef: [],
              monmap: [],
              uoBranch: [player(1, "Hero")],
            }),
          );

          const stringAfkFiber = yield* protocol
            .onceEvent(
              { kind: "projection", type: "playerAfk" },
              { timeout: "1 second" },
            )
            .pipe(Effect.forkScoped);
          const stringLocationFiber = yield* protocol
            .onceEvent(
              { kind: "projection", type: "playerLocation" },
              { timeout: "1 second" },
            )
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          yield* harness.publish(
            extensionStr("uotls", [
              "unused",
              "Hero",
              "afk:true,px:150,py:260,strFrame:r2,strPad:Left",
            ]),
          );
          const stringAfk = yield* Fiber.join(stringAfkFiber);
          expect(stringAfk?.type).toBe("playerAfk");
          expect(
            stringAfk?.type === "playerAfk" ? stringAfk.payload : null,
          ).toEqual({
            afk: true,
            entityId: 1,
            isSelf: true,
            username: "Hero",
          });
          const stringLocation = yield* Fiber.join(stringLocationFiber);
          expect(stringLocation?.type).toBe("playerLocation");
          expect(
            stringLocation?.type === "playerLocation"
              ? stringLocation.payload
              : null,
          ).toEqual({
            cell: "r2",
            entityId: 1,
            isSelf: true,
            pad: "Left",
            position: { x: 150, y: 260 },
            username: "Hero",
          });
          expect((yield* world.getPlayer("Hero"))?.position).toEqual({
            x: 150,
            y: 260,
          });
          expect((yield* world.getPlayer("Hero"))?.cell).toBe("r2");

          const jsonAfkFiber = yield* protocol
            .onceEvent(
              { kind: "projection", type: "playerAfk" },
              { timeout: "1 second" },
            )
            .pipe(Effect.forkScoped);
          const jsonLocationFiber = yield* protocol
            .onceEvent(
              { kind: "projection", type: "playerLocation" },
              { timeout: "1 second" },
            )
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          yield* harness.publish(
            extensionJson("uotls", {
              o: {
                afk: false,
                intHP: 75,
                intHPMax: 250,
                intMP: 40,
                intMPMax: 90,
                intState: 2,
                strFrame: "r3",
                strPad: "Right",
                tx: 300,
                ty: 320,
              },
              unm: "Hero",
            }),
          );
          const jsonAfk = yield* Fiber.join(jsonAfkFiber);
          expect(jsonAfk?.type).toBe("playerAfk");
          expect(
            jsonAfk?.type === "playerAfk" ? jsonAfk.payload : null,
          ).toEqual({
            afk: false,
            entityId: 1,
            isSelf: true,
            username: "Hero",
          });
          const jsonLocation = yield* Fiber.join(jsonLocationFiber);
          expect(jsonLocation?.type).toBe("playerLocation");
          expect(
            jsonLocation?.type === "playerLocation"
              ? jsonLocation.payload
              : null,
          ).toEqual({
            cell: "r3",
            entityId: 1,
            isSelf: true,
            pad: "Right",
            position: { x: 300, y: 320 },
            username: "Hero",
          });

          const hero = yield* world.getPlayer("Hero");
          expect(hero?.afk).toBe(false);
          expect(hero?.hp).toBe(75);
          expect(hero?.maxHp).toBe(250);
          expect(hero?.mp).toBe(40);
          expect(hero?.maxMp).toBe(90);
          expect(hero?.state).toBe(EntityState.InCombat);
          expect(hero?.cell).toBe("r3");
          expect(hero?.pad).toBe("Right");
          expect(hero?.position).toEqual({ x: 300, y: 320 });
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("moveToArea replaces stale area state and aura indexes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const world = yield* WorldState;
          yield* world.addPlayer(
            new LivePlayer({
              afk: false,
              cell: "Old",
              entityId: 99,
              entityType: "player",
              hp: 100,
              level: 1,
              maxHp: 100,
              maxMp: 50,
              mp: 50,
              name: "Stale",
              pad: "Spawn",
              position: { x: 0, y: 0 },
              state: EntityState.Idle,
              username: "Stale",
            }),
          );
          yield* world.addMonster(
            new LiveMonster({
              cell: "Old",
              hp: 100,
              level: 1,
              maxHp: 100,
              maxMp: 30,
              monsterId: 99,
              monsterMapId: 99,
              mp: 30,
              name: "Stale Monster",
              race: "",
              state: EntityState.Idle,
            }),
          );
          yield* world.setAura(
            "player",
            99,
            new LiveAura({
              duration: 10,
              name: "Old Player Aura",
              stack: 1,
            }),
          );
          yield* world.setAura(
            "monster",
            99,
            new LiveAura({
              duration: 10,
              name: "Old Monster Aura",
              stack: 1,
            }),
          );

          yield* harness.publish(
            extensionJson("moveToArea", {
              areaId: 44,
              areaName: "battleon-9001",
              monBranch: [monster(7, "Sneevil", { MonID: 11 })],
              mondef: [
                {
                  MonID: 11,
                  iLvl: 5,
                  intHPMax: 200,
                  intMPMax: 100,
                  strMonName: "Sneevil",
                },
              ],
              monmap: [{ MonMapID: 7, strFrame: "r4" }],
              uoBranch: [player(1, "Hero", { strFrame: "Enter" })],
            }),
          );

          expect(yield* world.getPlayer(99)).toBeNull();
          expect(yield* world.getMonster({ monMapId: 99 })).toBeNull();
          expect(yield* world.getPlayerAuras(99)).toEqual([]);
          expect(yield* world.getMonsterAuras(99)).toEqual([]);
          expect((yield* world.getPlayer(1))?.username).toBe("Hero");
          expect((yield* world.getMonster({ monMapId: 7 }))?.name).toBe(
            "Sneevil",
          );
          expect(yield* world.getMap()).toEqual({
            id: 44,
            name: "battleon",
            roomNumber: 9001,
          });
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("uses outer uid for user init packets", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const world = yield* WorldState;

          yield* harness.publish(
            extensionJson("initUserData", {
              data: player(0, "Hero", { entID: undefined }),
              uid: 42,
            }),
          );
          expect((yield* world.getPlayer(42))?.username).toBe("Hero");
          expect((yield* world.getMe())?.entityId).toBe(42);

          yield* harness.publish(
            extensionJson("initUserDatas", {
              a: [
                {
                  data: player(0, "Ally", { entID: undefined }),
                  uid: 43,
                },
              ],
            }),
          );
          expect((yield* world.getPlayer(43))?.username).toBe("Ally");
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "projects combat player, monster, and aura state from ct and cb",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();

        yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* FlashProtocol;
            const world = yield* WorldState;
            const monsterDeaths = yield* Ref.make<readonly FlashEvent[]>([]);
            const disposeMonsterDeaths = yield* protocol.onEvent(
              { kind: "projection", type: "monsterDeath" },
              (event) =>
                Ref.update(monsterDeaths, (events) => [...events, event]),
            );
            yield* Effect.addFinalizer(() => Effect.sync(disposeMonsterDeaths));

            yield* harness.publish(
              extensionJson("moveToArea", {
                areaId: 1,
                areaName: "battleon-1001",
                monBranch: [monster(7, "Training Dummy")],
                mondef: [],
                monmap: [],
                uoBranch: [player(1, "Hero")],
              }),
            );

            yield* harness.publish(
              extensionJson("addGoldExp", {
                id: 7,
                intExp: 10,
                intGold: 5,
                typ: "m",
              }),
            );
            expect(yield* Ref.get(monsterDeaths)).toHaveLength(0);
            expect((yield* world.getMonster({ monMapId: 7 }))?.hp).toBe(100);

            yield* harness.publish(
              extensionJson("ct", {
                a: [
                  {
                    auras: [{ dur: 5, nam: "Counter Attack" }],
                    cmd: "aura+",
                    tInf: "m:7",
                  },
                ],
                m: {
                  7: { intHP: 0, intMP: 0, intState: 0 },
                },
                p: {
                  Hero: { intHP: 25, intMP: 10, intState: 2 },
                },
              }),
            );
            const deathsAfterCt = yield* Ref.get(monsterDeaths);
            const monsterDeath = deathsAfterCt[0];

            expect((yield* world.getPlayer("Hero"))?.hp).toBe(25);
            expect((yield* world.getMonster({ monMapId: 7 }))?.hp).toBe(0);
            expect(deathsAfterCt).toHaveLength(1);
            expect(monsterDeath?.type).toBe("monsterDeath");
            expect(
              monsterDeath?.type === "monsterDeath"
                ? monsterDeath.payload.monsterMapId
                : undefined,
            ).toBe(7);
            expect((yield* world.getMonsterAuras(7))[0]?.name).toBe(
              "Counter Attack",
            );

            yield* harness.publish(
              extensionJson("mtls", {
                id: 7,
                o: { intHP: 0, intMP: 0, intState: 0 },
              }),
            );
            expect(yield* Ref.get(monsterDeaths)).toHaveLength(1);

            yield* harness.publish(
              extensionJson("mtls", {
                id: 999,
                o: { intHP: 0, intMP: 0, intState: 0 },
              }),
            );
            expect(yield* Ref.get(monsterDeaths)).toHaveLength(1);

            yield* harness.publish(
              extensionJson("cb", {
                a: [
                  {
                    aura: { nam: "Counter Attack" },
                    cmd: "aura-",
                    tInf: "m:7",
                  },
                ],
              }),
            );

            expect(yield* world.getMonsterAuras(7)).toEqual([]);
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );
});
