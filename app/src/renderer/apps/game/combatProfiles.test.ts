import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";

import type {
  CombatProfile,
  CombatProfileStep,
} from "@lucent/core/combatProfiles";
import {
  castCombatProfileMessageTrigger,
  castNextCombatProfileStep,
  makeCombatProfileCursor,
  makeCombatProfileMessageTriggerState,
  matchesCombatProfileStep,
  matchesCombatProfileMessageTrigger,
  resetCombatProfileCursor,
  type CombatProfileRuntimeDeps,
} from "./combatProfiles";

const profile: CombatProfile = {
  id: "test-profile",
  label: "Test",
  delayMs: 150,
  cooldownMode: "use-if-ready",
  steps: [
    { skill: 1, conditions: [] },
    { skill: 2, conditions: [] },
  ],
};

const makeDeps = (overrides?: {
  readonly canUseSkill?: (skill: number | string) => Effect.Effect<boolean>;
  readonly getConsumableSkillItem?: () => Effect.Effect<{
    readonly itemId: number;
    readonly ready: boolean;
  } | null>;
  readonly useSkill?: (
    skill: number | string,
    options?: unknown,
  ) => Effect.Effect<boolean>;
}): CombatProfileRuntimeDeps => ({
  combat: {
    canUseSkill: () => Effect.succeed(true),
    getConsumableSkillItem: () => Effect.succeed(null),
    target: {
      auras: {
        get: () => Effect.succeed(null),
        getAll: () => Effect.succeed([]),
        has: () => Effect.succeed(false),
      },
      get: () => Effect.succeed(null),
    },
    useSkill: () => Effect.succeed(true),
    ...overrides,
  },
  player: {
    auras: {
      get: () => Effect.succeed(null),
      getAll: () => Effect.succeed([]),
      has: () => Effect.succeed(false),
    },
    getHp: () => Effect.succeed(100),
    getMaxHp: () => Effect.succeed(100),
    getMaxMp: () => Effect.succeed(100),
    getMp: () => Effect.succeed(100),
  },
  players: {
    getAll: () => Effect.succeed([]),
    getMe: () => Effect.succeed(null),
  },
});

describe("combat profile runtime", () => {
  it.effect(
    "uses strict priority order without advancing the rotation cursor",
    () =>
      Effect.gen(function* () {
        let prioritiesReady = true;
        const casts: number[] = [];
        const cursor = yield* makeCombatProfileCursor();
        const priorityProfile: CombatProfile = {
          ...profile,
          steps: [
            { skill: 1, conditions: [] },
            { skill: 2, conditions: [], priority: true },
            { skill: 3, conditions: [], priority: true },
          ],
        };
        const deps = makeDeps({
          canUseSkill: (skill) =>
            Effect.succeed(skill === 2 || skill === 3 ? prioritiesReady : true),
          useSkill: (skill) =>
            Effect.sync(() => {
              casts.push(Number(skill));
              return true;
            }),
        });

        expect(
          yield* castNextCombatProfileStep(deps, priorityProfile, cursor),
        ).toBe(true);
        expect(
          yield* castNextCombatProfileStep(deps, priorityProfile, cursor),
        ).toBe(true);
        prioritiesReady = false;
        expect(
          yield* castNextCombatProfileStep(deps, priorityProfile, cursor),
        ).toBe(true);

        expect(casts).toEqual([2, 2, 1]);
      }),
  );

  it.effect(
    "skips ineligible priority steps before attempting a later priority",
    () =>
      Effect.gen(function* () {
        const casts: number[] = [];
        const cursor = yield* makeCombatProfileCursor();
        const priorityProfile: CombatProfile = {
          ...profile,
          steps: [
            {
              skill: 1,
              conditions: [
                {
                  type: "self-hp",
                  op: "<=",
                  value: 20,
                  unit: "percent",
                },
              ],
              priority: true,
            },
            { skill: 2, conditions: [], priority: true },
            { skill: 3, conditions: [], priority: true },
            { skill: 4, conditions: [] },
          ],
        };
        const deps = makeDeps({
          canUseSkill: (skill) => Effect.succeed(skill !== 2),
          useSkill: (skill) =>
            Effect.sync(() => {
              casts.push(Number(skill));
              return true;
            }),
        });

        expect(
          yield* castNextCombatProfileStep(deps, priorityProfile, cursor),
        ).toBe(true);
        expect(casts).toEqual([3]);
      }),
  );

  it.effect("skips skill 5 when the prepared item is not ready", () =>
    Effect.gen(function* () {
      let slot = { itemId: 200, ready: true };
      const casts: number[] = [];
      const cursor = yield* makeCombatProfileCursor();
      const skill5Profile: CombatProfile = {
        ...profile,
        steps: [
          { skill: 5, conditions: [], priority: true },
          { skill: 1, conditions: [] },
        ],
      };
      const deps: CombatProfileRuntimeDeps = {
        ...makeDeps({
          getConsumableSkillItem: () => Effect.succeed(slot),
          useSkill: (skill) =>
            Effect.sync(() => {
              casts.push(Number(skill));
              return true;
            }),
        }),
        skill5ItemId: 100,
      };

      expect(
        yield* castNextCombatProfileStep(deps, skill5Profile, cursor),
      ).toBe(true);
      slot = { itemId: 100, ready: false };
      expect(
        yield* castNextCombatProfileStep(deps, skill5Profile, cursor),
      ).toBe(true);
      slot = { itemId: 100, ready: true };
      expect(
        yield* castNextCombatProfileStep(deps, skill5Profile, cursor),
      ).toBe(true);

      expect(casts).toEqual([1, 1, 5]);
    }),
  );

  it.effect(
    "stops after a failed waiting priority without advancing the cursor",
    () =>
      Effect.gen(function* () {
        let hp = 10;
        let laterPriorityReady = true;
        const casts: number[] = [];
        const castOptions: unknown[] = [];
        const cursor = yield* makeCombatProfileCursor();
        const target = { getAura: () => null, monsterMapId: 7 };
        const priorityProfile: CombatProfile = {
          ...profile,
          steps: [
            { skill: 4, conditions: [] },
            {
              skill: 1,
              conditions: [
                {
                  type: "self-hp",
                  op: "<=",
                  value: 20,
                  unit: "percent",
                },
              ],
              cooldownMode: "wait-for-cooldown",
              priority: true,
            },
            { skill: 5, conditions: [] },
            { skill: 2, conditions: [], priority: true },
          ],
        };
        const baseDeps = makeDeps({
          canUseSkill: (skill) =>
            Effect.succeed(skill === 2 ? laterPriorityReady : true),
          useSkill: (skill, options) =>
            Effect.sync(() => {
              casts.push(Number(skill));
              castOptions.push(options);
              return skill !== 1;
            }),
        });
        const deps: CombatProfileRuntimeDeps = {
          ...baseDeps,
          player: {
            ...baseDeps.player,
            getHp: () => Effect.succeed(hp),
          },
        };

        expect(
          yield* castNextCombatProfileStep(
            deps,
            priorityProfile,
            cursor,
            target,
          ),
        ).toBe(false);
        expect(casts).toEqual([1]);
        expect(castOptions).toEqual([{ target: 7, wait: true }]);

        hp = 100;
        laterPriorityReady = false;
        expect(
          yield* castNextCombatProfileStep(deps, priorityProfile, cursor),
        ).toBe(true);
        expect(casts).toEqual([1, 4]);
      }),
  );

  it.effect("advances the rotation cursor after a failed cast", () =>
    Effect.gen(function* () {
      const casts: number[] = [];
      const cursor = yield* makeCombatProfileCursor();
      const deps = makeDeps({
        useSkill: (skill) =>
          Effect.sync(() => {
            casts.push(Number(skill));
            return casts.length > 1;
          }),
      });

      expect(yield* castNextCombatProfileStep(deps, profile, cursor)).toBe(
        false,
      );
      expect(yield* castNextCombatProfileStep(deps, profile, cursor)).toBe(
        true,
      );
      expect(casts).toEqual([1, 2]);
    }),
  );

  it.effect("keeps a concurrent cursor reset after a successful cast", () =>
    Effect.gen(function* () {
      const casts: number[] = [];
      const castStarted = yield* Deferred.make<void>();
      const releaseCast = yield* Deferred.make<void>();
      const cursor = yield* makeCombatProfileCursor();
      const deps = makeDeps({
        useSkill: (skill) =>
          Effect.gen(function* () {
            casts.push(Number(skill));
            if (casts.length === 1) {
              yield* Deferred.succeed(castStarted, undefined);
              yield* Deferred.await(releaseCast);
            }
            return true;
          }),
      });

      const castFiber = yield* castNextCombatProfileStep(
        deps,
        profile,
        cursor,
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(castStarted);
      yield* resetCombatProfileCursor(cursor);
      yield* Deferred.succeed(releaseCast, undefined);

      expect(yield* Fiber.join(castFiber)).toBe(true);
      expect(yield* castNextCombatProfileStep(deps, profile, cursor)).toBe(
        true,
      );
      expect(casts).toEqual([1, 1]);
    }),
  );

  it.effect("evaluates stat and aura conditions at their boundaries", () =>
    Effect.gen(function* () {
      const base = makeDeps();
      const deps: CombatProfileRuntimeDeps = {
        ...base,
        combat: {
          ...base.combat,
          target: {
            ...base.combat.target,
            auras: {
              ...base.combat.target.auras,
              get: (name) =>
                Effect.succeed(
                  name === "Guard" ? ({ stack: 1 } as never) : null,
                ),
            },
            get: () => Effect.succeed({ type: "monster" } as never),
          },
        },
        player: {
          ...base.player,
          auras: {
            ...base.player.auras,
            get: (name) =>
              Effect.succeed(name === "Focus" ? ({ stack: 3 } as never) : null),
          },
          getHp: () => Effect.succeed(40),
          getMp: () => Effect.succeed(20),
        },
        players: {
          getAll: () =>
            Effect.succeed([
              {
                entityId: 2,
                hp: 20,
                maxHp: 100,
                username: "Ally",
              } as never,
            ]),
          getMe: () => Effect.succeed(null),
        },
      };
      const step: CombatProfileStep = {
        skill: 1,
        conditions: [
          { type: "self-hp", op: "<=", value: 40, unit: "percent" },
          { type: "self-mp", op: ">=", value: 20, unit: "value" },
          { type: "ally-hp", op: "<=", value: 20, unit: "percent" },
          { type: "self-aura", auraName: "Focus", op: ">=", value: 3 },
          { type: "target-aura", auraName: "Guard", op: ">=", value: 1 },
        ],
      };
      const unguardedTarget = {
        getAura: () => null,
        monsterMapId: 8,
      };

      expect(yield* matchesCombatProfileStep(deps, step)).toBe(true);
      expect(yield* matchesCombatProfileStep(deps, step, unguardedTarget)).toBe(
        false,
      );
      expect(
        yield* matchesCombatProfileStep(
          {
            ...deps,
            player: {
              ...deps.player,
              getHp: () => Effect.succeed(41),
            },
          },
          step,
        ),
      ).toBe(false);
    }),
  );

  it("matches trigger messages by normalized substring and source", () => {
    expect(
      matchesCombatProfileMessageTrigger(
        {
          messageIncludes: "WARDEN  prepares",
          skill: 5,
          source: "animation",
        },
        {
          message: "Ultra Warden prepares a strike",
          source: "animation",
        },
      ),
    ).toBe(true);
    expect(
      matchesCombatProfileMessageTrigger(
        {
          messageIncludes: "Warden prepares",
          skill: 5,
          source: "aura",
        },
        {
          message: "Ultra Warden prepares a strike",
          source: "animation",
        },
      ),
    ).toBe(false);
  });

  it.effect("casts on message monsters and respects trigger cooldowns", () =>
    Effect.gen(function* () {
      const skills: number[] = [];
      const skillOptions: unknown[] = [];
      const state = yield* makeCombatProfileMessageTriggerState();
      const deps = makeDeps({
        useSkill: (skill, options) =>
          Effect.sync(() => {
            skills.push(Number(skill));
            skillOptions.push(options);
            return true;
          }),
      });
      const trigger = {
        cooldownMs: 1_000,
        messageIncludes: "enrage",
        skill: 5,
        source: "any" as const,
      };
      const event = {
        message: "Boss enrage",
        monsterMapId: 7,
        source: "aura" as const,
      };

      expect(
        yield* castCombatProfileMessageTrigger(
          deps,
          trigger,
          0,
          event,
          state,
          100,
        ),
      ).toBe(true);
      expect(
        yield* castCombatProfileMessageTrigger(
          deps,
          trigger,
          0,
          event,
          state,
          500,
        ),
      ).toBe(false);
      expect(
        yield* castCombatProfileMessageTrigger(
          deps,
          trigger,
          1,
          event,
          state,
          500,
        ),
      ).toBe(true);
      expect(
        yield* castCombatProfileMessageTrigger(
          deps,
          trigger,
          0,
          event,
          state,
          1_200,
        ),
      ).toBe(true);

      expect(skills).toEqual([5, 5, 5]);
      expect(skillOptions).toEqual([
        { force: true, target: 7, wait: true },
        { force: true, target: 7, wait: true },
        { force: true, target: 7, wait: true },
      ]);
    }),
  );

  it.effect("serializes concurrent message trigger cooldown checks", () =>
    Effect.gen(function* () {
      const state = yield* makeCombatProfileMessageTriggerState();
      const firstCastStarted = yield* Deferred.make<void>();
      const releaseCasts = yield* Deferred.make<void>();
      const skillCalls = yield* Ref.make<readonly number[]>([]);
      const deps = makeDeps({
        useSkill: (skill) =>
          Effect.gen(function* () {
            const calls = yield* Ref.updateAndGet(skillCalls, (current) => [
              ...current,
              Number(skill),
            ]);
            if (calls.length === 1) {
              yield* Deferred.succeed(firstCastStarted, undefined);
            }
            yield* Deferred.await(releaseCasts);
            return true;
          }),
      });
      const trigger = {
        cooldownMs: 1_000,
        messageIncludes: "enrage",
        skill: 5,
        source: "any" as const,
      };
      const event = {
        message: "Boss enrage",
        source: "aura" as const,
      };

      const firstFiber = yield* castCombatProfileMessageTrigger(
        deps,
        trigger,
        0,
        event,
        state,
        100,
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(firstCastStarted);

      const secondFiber = yield* castCombatProfileMessageTrigger(
        deps,
        trigger,
        0,
        event,
        state,
        100,
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseCasts, undefined);

      expect(yield* Fiber.join(firstFiber)).toBe(true);
      expect(yield* Fiber.join(secondFiber)).toBe(false);
      expect(yield* Ref.get(skillCalls)).toEqual([5]);
    }),
  );
});
