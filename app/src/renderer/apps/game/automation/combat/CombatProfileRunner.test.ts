import type { CombatProfile } from "@lucent/core/combatProfiles";
import { EntityState, LiveMonster } from "@lucent/game";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Event, EventType } from "../../flash/contract/Event";
import type { ApiService } from "../../flash/api/Api";
import {
  COMBAT_PROFILE_RETRY_DELAY_MS,
  makeCombatProfileRunner,
  selectCombatProfileTarget,
} from "./CombatProfileRunner";

const profile: CombatProfile = {
  cooldownMode: "use-if-ready",
  delayMs: 120,
  id: "runner-test",
  label: "Runner test",
  role: "Base",
  steps: [
    { conditions: [], skill: 1 },
    { conditions: [], skill: 2 },
  ],
};

const makeMonster = (
  monsterMapId: number,
  name: string,
  overrides: Partial<{
    readonly hp: number;
    readonly state: EntityState;
  }> = {},
) =>
  new LiveMonster({
    cell: "Enter",
    hp: overrides.hp ?? 100,
    level: 1,
    maxHp: 100,
    maxMp: 0,
    monsterId: monsterMapId,
    monsterMapId,
    mp: 0,
    name,
    race: "None",
    state: overrides.state ?? EntityState.Idle,
  });

const first = makeMonster(1, "First");
const priority = makeMonster(2, "Priority");

type EventHandler = (event: Event) => Effect.Effect<void, unknown>;

const makeHarness = (options?: {
  readonly alive?: boolean;
  readonly attackMonster?: (monsterMapId: number) => Effect.Effect<boolean>;
  readonly monsters?: readonly LiveMonster[];
  readonly useSkill?: (skill: number) => Effect.Effect<boolean>;
}) => {
  const attacks: number[] = [];
  const casts: number[] = [];
  const handlers = new Map<EventType, Set<EventHandler>>();

  const emit = (event: Event) =>
    Effect.all(
      [...(handlers.get(event.type) ?? [])].map((handler) => handler(event)),
      { discard: true },
    );

  const api = {
    combat: {
      attackMonster: (monsterMapId: number) => {
        attacks.push(monsterMapId);
        return options?.attackMonster?.(monsterMapId) ?? Effect.succeed(true);
      },
      canUseSkill: () => Effect.succeed(true),
      target: {
        auras: { get: () => Effect.succeed(null) },
        get: () => Effect.succeed(null),
      },
      useSkill: (skill: number) => {
        casts.push(skill);
        return options?.useSkill?.(skill) ?? Effect.succeed(true);
      },
    },
    events: {
      on: (selector: { readonly type: EventType }, handler: EventHandler) =>
        Effect.sync(() => {
          const registered =
            handlers.get(selector.type) ?? new Set<EventHandler>();
          registered.add(handler);
          handlers.set(selector.type, registered);
          return () => {
            registered.delete(handler);
          };
        }),
    },
    monsters: {
      getAvailable: () =>
        Effect.succeed(options?.monsters ?? [first, priority]),
    },
    player: {
      auras: { get: () => Effect.succeed(null) },
      getHp: () => Effect.succeed(100),
      getMaxHp: () => Effect.succeed(100),
      getMaxMp: () => Effect.succeed(100),
      getMp: () => Effect.succeed(100),
      isAlive: () => Effect.succeed(options?.alive ?? true),
    },
    players: {
      getAll: () => Effect.succeed([]),
      getMe: () => Effect.succeed(null),
    },
  } as unknown as ApiService;

  return {
    api,
    attacks,
    casts,
    emit,
    handlerCount: () =>
      [...handlers.values()].reduce(
        (count, current) => count + current.size,
        0,
      ),
  };
};

describe("CombatProfileRunner", () => {
  it("selects living priority targets before the first available fallback", () => {
    const dead = makeMonster(3, "Dead", {
      hp: 0,
      state: EntityState.Dead,
    });
    expect(
      selectCombatProfileTarget([dead, first, priority], ["Priority"]),
    ).toBe(priority);
    expect(selectCombatProfileTarget([dead, first, priority], [])).toBe(first);
  });

  it.effect("gates dead players and returns the shared cycle delays", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dead = makeHarness({ alive: false });
        const deadRunner = yield* makeCombatProfileRunner(dead.api, {
          profile,
          targetPriority: [],
        });
        expect(yield* deadRunner.runCycle()).toEqual({
          delayMs: COMBAT_PROFILE_RETRY_DELAY_MS,
          kind: "player-dead",
        });
        expect(dead.attacks).toEqual([]);

        const rejected = makeHarness({
          attackMonster: () => Effect.succeed(false),
        });
        const rejectedRunner = yield* makeCombatProfileRunner(rejected.api, {
          profile,
          targetPriority: ["Priority"],
        });
        expect(yield* rejectedRunner.runCycle()).toEqual({
          delayMs: COMBAT_PROFILE_RETRY_DELAY_MS,
          kind: "attack-rejected",
        });
        expect(rejected.attacks).toEqual([priority.monsterMapId]);

        const successful = makeHarness();
        const successfulRunner = yield* makeCombatProfileRunner(
          successful.api,
          {
            profile,
            targetPriority: [],
          },
        );
        expect(yield* successfulRunner.runCycle()).toEqual({
          cast: true,
          delayMs: profile.delayMs,
          kind: "attacked",
        });
      }),
    ),
  );

  it.effect("labels target, attack, and profile failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const targetFailure = makeHarness();
        const targetRunner = yield* makeCombatProfileRunner(
          {
            ...targetFailure.api,
            monsters: {
              getAvailable: () => Effect.die("target failed"),
            },
          } as unknown as ApiService,
          { profile, targetPriority: [] },
        );
        expect((yield* Effect.flip(targetRunner.runCycle())).stage).toBe(
          "target-selection",
        );

        const attackFailure = makeHarness({
          attackMonster: () => Effect.die("attack failed"),
        });
        const attackRunner = yield* makeCombatProfileRunner(attackFailure.api, {
          profile,
          targetPriority: [],
        });
        expect((yield* Effect.flip(attackRunner.runCycle())).stage).toBe(
          "attack",
        );

        const profileFailure = makeHarness({
          useSkill: () => Effect.die("profile failed"),
        });
        const profileRunner = yield* makeCombatProfileRunner(
          profileFailure.api,
          { profile, targetPriority: [] },
        );
        expect((yield* Effect.flip(profileRunner.runCycle())).stage).toBe(
          "profile-cast",
        );
      }),
    ),
  );

  it.effect("resets rotations on death and disposes scoped listeners", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const eventProfile: CombatProfile = {
        ...profile,
        messageTriggers: [
          {
            messageIncludes: "enrage",
            skill: 5,
            source: "any",
          },
        ],
        resetSkillIndexOnMonsterDeath: true,
      };

      yield* Effect.scoped(
        Effect.gen(function* () {
          const runner = yield* makeCombatProfileRunner(harness.api, {
            profile: eventProfile,
            targetPriority: [],
          });
          expect(harness.handlerCount()).toBe(2);

          yield* runner.runCycle();
          yield* harness.emit({ monsterMapId: 1, type: "monster-death" });
          yield* runner.runCycle();
          yield* harness.emit({
            message: "Boss enrage",
            source: "animation",
            type: "update-message",
          });

          expect(harness.casts).toEqual([1, 1, 5]);
        }),
      );

      expect(harness.handlerCount()).toBe(0);
    }),
  );

  it.effect("reports asynchronous trigger failures by stage", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failures: string[] = [];
        const harness = makeHarness({
          useSkill: () => Effect.die("trigger failed"),
        });
        const eventProfile: CombatProfile = {
          ...profile,
          messageTriggers: [
            {
              messageIncludes: "enrage",
              skill: 5,
              source: "any",
            },
          ],
        };
        yield* makeCombatProfileRunner(harness.api, {
          onAsyncFailure: (failure) =>
            Effect.sync(() => {
              failures.push(failure.stage);
            }),
          profile: eventProfile,
          targetPriority: [],
        });

        yield* harness.emit({
          message: "Boss enrage",
          source: "animation",
          type: "update-message",
        });

        expect(failures).toEqual(["message-trigger"]);
      }),
    ),
  );

  it.effect("keeps runner cursors independent", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = makeHarness();
        const left = yield* makeCombatProfileRunner(harness.api, {
          profile,
          targetPriority: [],
        });
        const right = yield* makeCombatProfileRunner(harness.api, {
          profile,
          targetPriority: [],
        });

        yield* left.runCycle();
        yield* right.runCycle();
        yield* left.runCycle();

        expect(harness.casts).toEqual([1, 1, 2]);
      }),
    ),
  );
});
