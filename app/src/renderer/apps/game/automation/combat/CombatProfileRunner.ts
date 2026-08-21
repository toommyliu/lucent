import type { CombatProfile } from "@lucent/core/combatProfiles";
import {
  EntityState,
  orderMonstersByPriority,
  type Monster,
  type MonsterQuery,
} from "@lucent/game";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import {
  castCombatProfileMessageTriggers,
  castNextCombatProfileStep,
  makeCombatProfileCursor,
  makeCombatProfileMessageTriggerState,
  makeCombatProfileRuntimeDeps,
  makeCombatProfileTargetTracker,
  resetCombatProfileOnTargetDeath,
  trackCombatProfileAttack,
} from "../../combatProfiles";
import type { ApiService } from "../../flash/api/Api";

export const COMBAT_PROFILE_RETRY_DELAY_MS = 250;

export type CombatProfileRunFailureStage =
  | "attack"
  | "message-trigger"
  | "profile-cast"
  | "target-selection";

const failureMessage = (
  stage: CombatProfileRunFailureStage,
  cause: Cause.Cause<never>,
): string => {
  const squashed = Cause.squash(cause);
  if (squashed instanceof Error && squashed.message !== "") {
    return squashed.message;
  }
  if (typeof squashed === "string" && squashed !== "") {
    return squashed;
  }

  const pretty = Cause.pretty(cause).split("\n")[0];
  return pretty === undefined || pretty === ""
    ? `Combat profile ${stage} failed`
    : pretty;
};

export class CombatProfileRunError extends Error {
  readonly _tag = "CombatProfileRunError";

  constructor(
    readonly stage: CombatProfileRunFailureStage,
    readonly failureCause: Cause.Cause<never>,
  ) {
    super(failureMessage(stage, failureCause));
    this.name = "CombatProfileRunError";
  }
}

export type CombatProfileCycleResult =
  | {
      readonly delayMs: typeof COMBAT_PROFILE_RETRY_DELAY_MS;
      readonly kind: "attack-rejected" | "no-target" | "player-dead";
    }
  | {
      readonly cast: boolean;
      readonly delayMs: number;
      readonly kind: "attacked";
    };

export interface CombatProfileRunnerCycleOptions {
  readonly beforeAttack?: (target: Monster) => Effect.Effect<void>;
}

export interface CombatProfileRunnerOptions {
  readonly onAsyncFailure?: (
    failure: CombatProfileRunError,
  ) => Effect.Effect<void>;
  readonly profile: CombatProfile;
  readonly targetPriority: readonly MonsterQuery[];
}

const withFailureStage = <A, R>(
  stage: CombatProfileRunFailureStage,
  effect: Effect.Effect<A, never, R>,
): Effect.Effect<A, CombatProfileRunError, R> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.fail(new CombatProfileRunError(stage, cause)),
    ),
  );

export const selectCombatProfileTarget = (
  monsters: readonly Monster[],
  priorities: readonly MonsterQuery[],
): Monster | undefined => {
  const available = monsters.filter(
    (monster) => monster.hp > 0 && monster.state !== EntityState.Dead,
  );
  return orderMonstersByPriority(available, priorities)[0] ?? available[0];
};

export const makeCombatProfileRunner = Effect.fn("makeCombatProfileRunner")(
  function* (api: ApiService, options: CombatProfileRunnerOptions) {
    const cursor = yield* makeCombatProfileCursor();
    const targetTracker =
      options.profile.resetSkillIndexOnTargetDeath === true
        ? yield* makeCombatProfileTargetTracker(cursor)
        : null;
    const messageState = yield* makeCombatProfileMessageTriggerState();
    const prepared = yield* Effect.acquireRelease(
      api.combat.prepareCombatProfileConsumable(options.profile),
      (result) => result.release,
    );
    const dependencies = makeCombatProfileRuntimeDeps(
      api.combat,
      api.player,
      api.players,
      prepared.skill5ItemId,
    );

    if ((options.profile.messageTriggers?.length ?? 0) > 0) {
      const disposeMessages = yield* api.events.on(
        { type: "update-message" },
        (event) =>
          withFailureStage(
            "message-trigger",
            castCombatProfileMessageTriggers(
              dependencies,
              options.profile,
              {
                message: event.message,
                ...(event.monsterMapId === undefined
                  ? {}
                  : { monMapId: event.monsterMapId }),
                source: event.source,
              },
              messageState,
            ),
          ).pipe(
            Effect.catch((failure) =>
              options.onAsyncFailure === undefined
                ? Effect.logError({
                    cause: failure.failureCause,
                    message: "Combat profile message trigger failed",
                  })
                : options.onAsyncFailure(failure),
            ),
          ),
      );
      yield* Effect.addFinalizer(() => Effect.sync(disposeMessages));
    }

    if (targetTracker !== null) {
      const disposeMonsterDeath = yield* api.events.on(
        { type: "monster-death" },
        (event) =>
          resetCombatProfileOnTargetDeath(targetTracker, event.monsterMapId),
      );
      yield* Effect.addFinalizer(() => Effect.sync(disposeMonsterDeath));
    }

    const runCycle = Effect.fn("CombatProfileRunner.runCycle")(function* (
      cycleOptions: CombatProfileRunnerCycleOptions = {},
    ): Effect.fn.Return<CombatProfileCycleResult, CombatProfileRunError> {
      const alive = yield* withFailureStage(
        "target-selection",
        api.player.isAlive(),
      );
      if (!alive) {
        return {
          delayMs: COMBAT_PROFILE_RETRY_DELAY_MS,
          kind: "player-dead",
        };
      }

      const monsters = yield* withFailureStage(
        "target-selection",
        api.monsters.getAvailable(),
      );
      const target = selectCombatProfileTarget(
        monsters,
        options.targetPriority,
      );
      if (target === undefined) {
        return {
          delayMs: COMBAT_PROFILE_RETRY_DELAY_MS,
          kind: "no-target",
        };
      }

      if (cycleOptions.beforeAttack !== undefined) {
        yield* withFailureStage(
          "target-selection",
          cycleOptions.beforeAttack(target),
        );
      }

      const attack = api.combat.attackMonster(target.monsterMapId);
      const attacked = yield* withFailureStage(
        "attack",
        targetTracker === null
          ? attack
          : trackCombatProfileAttack(
              targetTracker,
              target.monsterMapId,
              attack,
            ),
      );
      if (!attacked) {
        return {
          delayMs: COMBAT_PROFILE_RETRY_DELAY_MS,
          kind: "attack-rejected",
        };
      }

      const cast = yield* withFailureStage(
        "profile-cast",
        castNextCombatProfileStep(dependencies, options.profile, cursor),
      );
      return {
        cast,
        delayMs: cast
          ? Math.max(50, options.profile.delayMs)
          : COMBAT_PROFILE_RETRY_DELAY_MS,
        kind: "attacked",
      };
    });

    return {
      runCycle,
      ...(prepared.warning === undefined ? {} : { warning: prepared.warning }),
    };
  },
);

export type CombatProfileRunner = Effect.Success<
  ReturnType<typeof makeCombatProfileRunner>
>;
