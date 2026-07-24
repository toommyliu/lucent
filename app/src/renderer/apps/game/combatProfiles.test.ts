import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref } from "effect";

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
  role: "Base",
  delayMs: 150,
  cooldownMode: "use-if-ready",
  steps: [
    { skill: 1, conditions: [] },
    { skill: 2, conditions: [] },
  ],
};

const makeDeps = (overrides?: {
  readonly attackMonster?: (target: unknown) => Effect.Effect<boolean>;
  readonly useSkill?: (
    skill: number | string,
    options?: unknown,
  ) => Effect.Effect<boolean>;
}): CombatProfileRuntimeDeps => ({
  combat: {
    attackMonster: () => Effect.succeed(true),
    canUseSkill: () => Effect.succeed(true),
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

      expect(yield* matchesCombatProfileStep(deps, step)).toBe(true);
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

  it.effect("targets message monsters and respects trigger cooldowns", () =>
    Effect.gen(function* () {
      const targets: unknown[] = [];
      const skills: number[] = [];
      const state = yield* makeCombatProfileMessageTriggerState();
      const deps = makeDeps({
        attackMonster: (target) =>
          Effect.sync(() => {
            targets.push(target);
            return true;
          }),
        useSkill: (skill) =>
          Effect.sync(() => {
            skills.push(Number(skill));
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
        monMapId: 7,
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

      expect(targets).toEqual([
        { monMapId: 7 },
        { monMapId: 7 },
        { monMapId: 7 },
      ]);
      expect(skills).toEqual([5, 5, 5]);
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
