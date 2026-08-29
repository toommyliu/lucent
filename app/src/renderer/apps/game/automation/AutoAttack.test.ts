import { DEFAULT_COMBAT_PROFILE_LIBRARY } from "@lucent/core/combatProfiles";
import { EntityState, LiveMonster } from "@lucent/game";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Ref from "effect/Ref";

import type { ApiService } from "../flash/api/Api";
import type { Event, EventSelector } from "../flash/contract/Event";
import { makeAutoAttack } from "./AutoAttack";

const monster = new LiveMonster({
  cell: "Enter",
  hp: 100,
  level: 1,
  maxHp: 100,
  maxMp: 0,
  monsterId: 1,
  monsterMapId: 7,
  mp: 0,
  name: "Target",
  race: "None",
  state: EntityState.Idle,
});

describe("AutoAttack", () => {
  it.effect("replaces its fiber and cancels combat when disabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const casts = yield* Ref.make(0);
        const cancellations = yield* Ref.make(0);
        const fibers = yield* FiberMap.make<string>();
        const api = {
          combat: {
            attack: () => Effect.succeed(true),
            cancelAutoAttack: () =>
              Ref.update(cancellations, (count) => count + 1),
            cancelTarget: () => Ref.update(cancellations, (count) => count + 1),
            canUseSkill: () => Effect.succeed(true),
            getConsumableSkillItem: () => Effect.succeed(null),
            isAttackBlocked: () => Effect.succeed(false),
            prepareCombatProfileConsumable: () =>
              Effect.succeed({
                release: Effect.void,
                warning: "Skill 5 will use whichever consumable is available.",
              }),
            target: {
              auras: { get: () => Effect.succeed(null) },
              get: () => Effect.succeed(null),
            },
            useSkill: () =>
              Ref.update(casts, (count) => count + 1).pipe(Effect.as(true)),
          },
          events: {
            on: (
              _selector: EventSelector | undefined,
              _handler: (event: Event) => Effect.Effect<void>,
            ) => Effect.succeed(() => undefined),
          },
          monsters: { getAvailable: () => Effect.succeed([monster]) },
          player: {
            auras: { get: () => Effect.succeed(null) },
            getHp: () => Effect.succeed(100),
            getMaxHp: () => Effect.succeed(100),
            getMaxMp: () => Effect.succeed(100),
            getMp: () => Effect.succeed(100),
            isAlive: () => Effect.succeed(true),
          },
          players: {
            getAll: () => Effect.succeed([]),
            getMe: () => Effect.succeed(null),
          },
        } as unknown as ApiService;

        const autoAttack = yield* makeAutoAttack(api, fibers);
        const profile = DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]!;
        const options = {
          library: DEFAULT_COMBAT_PROFILE_LIBRARY,
          profileId: profile.id,
        };

        yield* autoAttack.enable(options);
        yield* Effect.yieldNow;
        expect(yield* autoAttack.getState()).toMatchObject({
          enabled: true,
          warning: "Skill 5 will use whichever consumable is available.",
        });
        yield* autoAttack.enable(options);
        yield* Effect.yieldNow;
        yield* autoAttack.disable();

        expect(yield* Ref.get(casts)).toBeGreaterThan(0);
        expect(yield* Ref.get(cancellations)).toBeGreaterThanOrEqual(2);
        expect((yield* autoAttack.getState()).running).toBe(false);
      }),
    ),
  );

  it.effect("disables only its active run after a combat failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attackStarted = yield* Deferred.make<void>();
        const cancellations = yield* Ref.make(0);
        const fibers = yield* FiberMap.make<string>();
        const api = {
          combat: {
            attack: () =>
              Deferred.succeed(attackStarted, undefined).pipe(
                Effect.andThen(Effect.die("attack exploded")),
              ),
            cancelAutoAttack: () =>
              Ref.update(cancellations, (count) => count + 1),
            cancelTarget: () => Ref.update(cancellations, (count) => count + 1),
            canUseSkill: () => Effect.succeed(true),
            getConsumableSkillItem: () => Effect.succeed(null),
            isAttackBlocked: () => Effect.succeed(false),
            prepareCombatProfileConsumable: () =>
              Effect.succeed({ release: Effect.void }),
            target: {
              auras: { get: () => Effect.succeed(null) },
              get: () => Effect.succeed(null),
            },
            useSkill: () => Effect.succeed(true),
          },
          events: {
            on: () => Effect.succeed(() => undefined),
          },
          monsters: { getAvailable: () => Effect.succeed([monster]) },
          player: {
            auras: { get: () => Effect.succeed(null) },
            getHp: () => Effect.succeed(100),
            getMaxHp: () => Effect.succeed(100),
            getMaxMp: () => Effect.succeed(100),
            getMp: () => Effect.succeed(100),
            isAlive: () => Effect.succeed(true),
          },
          players: {
            getAll: () => Effect.succeed([]),
            getMe: () => Effect.succeed(null),
          },
        } as unknown as ApiService;
        const autoAttack = yield* makeAutoAttack(api, fibers);
        const profile = DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]!;

        yield* autoAttack.enable({
          library: DEFAULT_COMBAT_PROFILE_LIBRARY,
          profileId: profile.id,
        });
        yield* Deferred.await(attackStarted);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(yield* autoAttack.getState()).toMatchObject({
          enabled: false,
          lastError: "attack exploded",
        });
        expect(yield* Ref.get(cancellations)).toBeGreaterThanOrEqual(2);
      }),
    ),
  );
});
