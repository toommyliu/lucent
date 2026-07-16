import type { CombatProfileDefinition } from "@lucent/core/combatProfiles";
import { EntityState, LiveMonster, LivePlayer } from "@lucent/game";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import * as TestClock from "effect/testing/TestClock";

import { makePipeline } from "../protocol/Pipeline";
import { makeStore } from "../state/Store";
import { Bridge, makeBridge } from "../bridge/Bridge";
import { makeGateway } from "../bridge/Gateway";
import { toItem } from "../contract/payload/Items";
import { makeAuth } from "./Auth";
import { makeCombat } from "./Combat";
import type { Drops } from "./Drops";
import { makeEvents } from "./Events";
import { makeInventory } from "./Inventory";
import { makeMap } from "./Map";
import { makeMonsters } from "./Monsters";
import { makePlayer } from "./Player";
import { makePlayers } from "./Players";
import { makeSettings } from "./Settings";
import { makeTempInventory } from "./TempInventory";
import { makeWaitApi } from "./Wait";

const profile: CombatProfileDefinition = {
  cooldownMode: "use-if-ready",
  delayMs: 0,
  resetSkillIndexOnMonsterDeath: true,
  steps: [{ conditions: [], skill: 1 }],
};

describe("Combat", () => {
  it.effect(
    "kills priorities before the requested target and accepts a drop",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let skillUses = 0;
          let acceptedDrop = false;
          let currentTarget: number | undefined;
          const attackedTargets: number[] = [];
          const jumpedCells: string[] = [];
          const availableMonsters = new Set([7, 8]);
          const target = {} as Window;
          target.swf = {
            "combat.attackMonster": (selector: { monMapId?: number }) => {
              currentTarget = selector.monMapId;
              if (currentTarget !== undefined) {
                attackedTargets.push(currentTarget);
              }
              return currentTarget !== undefined;
            },
            "combat.cancelAutoAttack": () => undefined,
            "combat.cancelTarget": () => undefined,
            "combat.getSkillCooldownRemaining": () => 0,
            "combat.getTarget": () => null,
            "combat.useSkill": () => {
              if (currentTarget === undefined) return false;
              skillUses += 1;
              const defeated = currentTarget;
              availableMonsters.delete(defeated);
              target.onExtensionResponse?.(
                JSON.stringify({
                  dataObj: {
                    cmd: "cb",
                    m: {
                      [defeated]: {
                        intHP: 0,
                        intState: EntityState.Dead,
                      },
                    },
                  },
                  type: "json",
                }),
              );
              return true;
            },
            "player.jump": (cell: string) => {
              jumpedCells.push(cell);
            },
            "world.getAvailableMonsterMapIds": () => [...availableMonsters],
            "world.isMonsterAvailable": (monsterMapId: number) =>
              availableMonsters.has(monsterMapId),
          } as unknown as Window["swf"];

          const bridge = yield* makeBridge(target);
          const gateway = yield* makeGateway(target).pipe(
            Effect.provideService(Bridge, bridge),
          );
          const store = yield* makeStore;
          const wait = makeWaitApi(bridge, gateway);
          const events = yield* makeEvents(gateway, wait);
          const auth = makeAuth(bridge, store, wait);
          const inventory = makeInventory(bridge, store, wait);
          const map = makeMap(bridge, store, wait);
          const monsters = makeMonsters(bridge, store);
          const players = makePlayers(store);
          const player = makePlayer(bridge, store, auth, inventory, map, wait);
          const settings = yield* makeSettings(bridge, store);
          const temporary = makeTempInventory(store);
          const drops: Drops = {
            accept: () =>
              store.items
                .upsert(
                  "inventory",
                  toItem(
                    { ItemID: 99, iQty: 1, sName: "Goal Item" },
                    { context: "inventory" },
                  ),
                )
                .pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      acceptedDrop = true;
                    }),
                  ),
                  Effect.as(true),
                ),
            contains: () => Effect.succeed(!acceptedDrop),
            getAll: () => Effect.succeed([]),
            isCustomUiEnabled: () => Effect.succeed(false),
            reject: () => Effect.succeed(false),
            toggleUi: () => Effect.void,
          };
          const combat = makeCombat(
            bridge,
            store,
            drops,
            events,
            inventory,
            map,
            monsters,
            player,
            players,
            settings,
            temporary,
            wait,
          );
          const pipeline = makePipeline(store, gateway, bridge);
          yield* gateway.start(pipeline.packet, pipeline.runtime);

          yield* store.world.putPlayer(
            new LivePlayer({
              afk: false,
              cell: "Enter",
              entityId: 1,
              entityType: "player",
              hp: 100,
              level: 1,
              maxHp: 100,
              maxMp: 100,
              mp: 100,
              name: "Hero",
              pad: "Spawn",
              position: { x: 0, y: 0 },
              state: EntityState.Idle,
              username: "Hero",
            }),
          );
          yield* store.world.setSelf("Hero");
          yield* store.world.putMonster(
            new LiveMonster({
              cell: "Enter",
              hp: 100,
              level: 1,
              maxHp: 100,
              maxMp: 0,
              monsterId: 2,
              monsterMapId: 7,
              mp: 0,
              name: "Target",
              race: "None",
              state: EntityState.Idle,
            }),
          );
          yield* store.world.putMonster(
            new LiveMonster({
              cell: "Enter",
              hp: 100,
              level: 1,
              maxHp: 100,
              maxMp: 0,
              monsterId: 3,
              monsterMapId: 8,
              mp: 0,
              name: "Priority",
              race: "None",
              state: EntityState.Idle,
            }),
          );

          availableMonsters.clear();
          expect((yield* combat.hunt("target"))?.monsterMapId).toBe(7);
          expect(jumpedCells).toEqual(["Enter"]);
          availableMonsters.add(7);
          availableMonsters.add(8);

          const killFiber = yield* combat
            .kill(7, { killPriority: [8], profile })
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;

          expect(yield* Fiber.join(killFiber)).toBe(true);
          expect(skillUses).toBe(2);
          expect(attackedTargets).toEqual([8, 7]);
          expect(yield* combat.killForItem(7, 99, 1)).toBe(true);
          expect(acceptedDrop).toBe(true);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );
});
