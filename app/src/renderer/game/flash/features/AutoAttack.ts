import { Cause, Context, Effect, Layer, Ref, Semaphore } from "effect";

import {
  getCombatProfileById,
  type CombatProfile,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import {
  castCombatProfileMessageTrigger,
  castNextCombatProfileStep,
  makeCombatProfileMessageTriggerState,
  makeCombatProfileCursor,
  makeCombatProfileRuntimeDeps,
  matchesCombatProfileMessageTrigger,
  resetCombatProfileCursor,
} from "../../combatProfiles";
import type { FlashEvent, Monster, TargetInfo } from "../Types";
import { EntityState } from "@lucent/game";
import { CombatApi } from "../api/Combat";
import { EventsApi } from "../api/Events";
import { MonstersApi } from "../api/Monsters";
import { PlayerApi } from "../api/Player";
import { PlayersApi } from "../api/Players";
import { normalizeName } from "../selectors";
import {
  makeStateListeners,
  type StateDisposer,
  type StateSubscriptionOptions,
} from "../StateListeners";
import { Jobs } from "../jobs/Jobs";

export type AutoAttackTargetPriority =
  | {
      readonly kind: "monster-map-id";
      readonly monsterMapId: number;
    }
  | {
      readonly kind: "monster-name";
      readonly name: string;
    };

export interface AutoAttackTargetSnapshot {
  readonly monsterMapId: number;
}

export interface AutoAttackStartOptions {
  readonly library: CombatProfileLibrary;
  readonly profileId: string;
  readonly targetPriority?: readonly AutoAttackTargetPriority[] | undefined;
}

export interface AutoAttackState {
  readonly enabled: boolean;
  readonly lastError?: string;
  readonly profileId?: string;
  readonly profileLabel?: string;
  readonly running: boolean;
}

export interface AutoAttackShape {
  readonly disable: () => Effect.Effect<AutoAttackState>;
  readonly enable: (
    options: AutoAttackStartOptions,
  ) => Effect.Effect<AutoAttackState>;
  readonly getState: () => Effect.Effect<AutoAttackState>;
  readonly isEnabled: () => Effect.Effect<boolean>;
  readonly onState: (
    listener: (state: AutoAttackState) => void,
    options?: StateSubscriptionOptions,
  ) => Effect.Effect<StateDisposer>;
}

export class AutoAttack extends Context.Service<AutoAttack, AutoAttackShape>()(
  "lucent/game/flash/features/AutoAttack",
) {}

interface AutoAttackRuntimeState {
  readonly enabled: boolean;
  readonly lastError: string | undefined;
  readonly profile: CombatProfile | undefined;
}

const AUTO_ATTACK_JOB_KEY = "feature:auto-attack";
const IDLE_DELAY_MS = 250;
const MIN_LOOP_DELAY_MS = 50;
const targetPrioritySeparatorPattern = /[,;\n]+/u;
const monsterMapIdPattern = /^id[.:'-]?([1-9]\d*)$/iu;

const initialState = (): AutoAttackRuntimeState => ({
  enabled: false,
  lastError: undefined,
  profile: undefined,
});

const isAttackableMonster = (monster: Monster): boolean =>
  monster.hp > 0 && monster.state !== EntityState.Dead;

const isAttackableTarget = (
  target: TargetInfo | null,
): target is Extract<TargetInfo, { readonly type: "monster" }> =>
  target !== null &&
  target.type === "monster" &&
  target.hp > 0 &&
  target.state !== EntityState.Dead;

const autoAttackFailureMessage = (cause: Cause.Cause<unknown>): string => {
  const detail = Cause.pretty(cause).split("\n")[0]?.trim();
  return detail === undefined || detail === ""
    ? "Auto attack stopped unexpectedly"
    : `Auto attack stopped: ${detail}`;
};

const publicState = (
  state: AutoAttackRuntimeState,
  running: boolean,
): AutoAttackState => ({
  enabled: state.enabled,
  running,
  ...(state.profile === undefined
    ? {}
    : {
        profileId: state.profile.id,
        profileLabel: state.profile.label,
      }),
  ...(state.lastError === undefined || state.lastError === ""
    ? {}
    : { lastError: state.lastError }),
});

export const parseAutoAttackTargetPriority = (
  value: string,
): readonly AutoAttackTargetPriority[] =>
  value
    .split(targetPrioritySeparatorPattern)
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((token) => {
      const monsterMapIdToken = token.match(monsterMapIdPattern);
      return monsterMapIdToken?.[1] === undefined
        ? {
            kind: "monster-name",
            name: token,
          }
        : {
            kind: "monster-map-id",
            monsterMapId: Number.parseInt(monsterMapIdToken[1], 10),
          };
    });

export const selectAutoAttackMonsterMapId = (options: {
  readonly available: readonly Monster[];
  readonly snapshotTarget?: AutoAttackTargetSnapshot | undefined;
  readonly targetPriority?: readonly AutoAttackTargetPriority[] | undefined;
}): number | undefined => {
  for (const target of options.targetPriority ?? []) {
    const match =
      target.kind === "monster-map-id"
        ? options.available.find(
            (monster) =>
              monster.monsterMapId === target.monsterMapId &&
              isAttackableMonster(monster),
          )
        : options.available.find(
            (monster) =>
              normalizeName(monster.name) === normalizeName(target.name) &&
              isAttackableMonster(monster),
          );
    if (match !== undefined) {
      return match.monsterMapId;
    }
  }

  if (options.snapshotTarget !== undefined) {
    const snapshotMatch = options.available.find(
      (monster) =>
        monster.monsterMapId === options.snapshotTarget?.monsterMapId &&
        isAttackableMonster(monster),
    );
    if (snapshotMatch !== undefined) {
      return snapshotMatch.monsterMapId;
    }
  }

  return options.available.find(isAttackableMonster)?.monsterMapId;
};

export const layer = Layer.effect(
  AutoAttack,
  Effect.gen(function* () {
    const combat = yield* CombatApi;
    const events = yield* EventsApi;
    const jobs = yield* Jobs;
    const monsters = yield* MonstersApi;
    const player = yield* PlayerApi;
    const players = yield* PlayersApi;
    const stateRef = yield* Ref.make<AutoAttackRuntimeState>(initialState());
    const messageTriggerState = yield* makeCombatProfileMessageTriggerState();
    const updateSemaphore = yield* Semaphore.make(1);
    const listeners = makeStateListeners<AutoAttackState>("autoattack");

    const snapshot = () =>
      Effect.all({
        running: jobs.isRunning(AUTO_ATTACK_JOB_KEY),
        state: Ref.get(stateRef),
      }).pipe(Effect.map(({ running, state }) => publicState(state, running)));

    const setLastError = (message: string | undefined) =>
      Ref.updateAndGet(stateRef, (state) =>
        state.lastError === message ? state : { ...state, lastError: message },
      ).pipe(
        Effect.flatMap((state) =>
          jobs
            .isRunning(AUTO_ATTACK_JOB_KEY)
            .pipe(Effect.map((running) => publicState(state, running))),
        ),
        Effect.tap(listeners.emit),
      );

    const clearLastError = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (state.lastError !== undefined) {
        yield* setLastError(undefined);
      }
    });

    const stopAfterUnexpectedFailure = (
      profile: CombatProfile,
      cause: Cause.Cause<unknown>,
    ) =>
      Effect.gen(function* () {
        const failedState = yield* Ref.modify(stateRef, (state) => {
          if (!state.enabled || state.profile !== profile) {
            return [null, state] as const;
          }

          const next = {
            enabled: false,
            lastError: autoAttackFailureMessage(cause),
            profile: undefined,
          };
          return [next, next] as const;
        });
        if (failedState === null) {
          return;
        }

        yield* Ref.set(messageTriggerState.state, new Map());
        yield* listeners.emit(publicState(failedState, false));
      });

    const snapshotTarget = Effect.gen(function* () {
      const currentTarget = yield* combat.target.get();
      return isAttackableTarget(currentTarget)
        ? { monsterMapId: currentTarget.monsterMapId }
        : undefined;
    });

    const loop = (
      profile: CombatProfile,
      targetPlan: {
        readonly snapshotTarget: AutoAttackTargetSnapshot | undefined;
        readonly targetPriority: readonly AutoAttackTargetPriority[];
      },
    ) => {
      let disposeMonsterDeath: StateDisposer | undefined;

      return Effect.gen(function* () {
        const cursor = yield* makeCombatProfileCursor();
        const activeTargetRef = yield* Ref.make<number | undefined>(undefined);
        disposeMonsterDeath = yield* events.on(
          { kind: "projection", type: "monsterDeath" },
          (event) =>
            Effect.gen(function* () {
              if (
                event.type !== "monsterDeath" ||
                profile.resetSkillIndexOnMonsterDeath !== true ||
                (yield* Ref.get(activeTargetRef)) !== event.payload.monsterMapId
              ) {
                return;
              }

              yield* resetCombatProfileCursor(cursor);
            }),
        );

        const runtimeDeps = makeCombatProfileRuntimeDeps(
          combat,
          player,
          players,
        );

        while ((yield* Ref.get(stateRef)).enabled) {
          const alive = yield* player.isAlive();
          if (!alive) {
            yield* Effect.sleep(`${IDLE_DELAY_MS} millis`);
            continue;
          }

          const available = yield* monsters.getAvailable();
          const target = selectAutoAttackMonsterMapId({
            available,
            snapshotTarget: targetPlan.snapshotTarget,
            targetPriority: targetPlan.targetPriority,
          });
          if (target === undefined) {
            yield* Ref.set(activeTargetRef, undefined);
            yield* Effect.sleep(`${IDLE_DELAY_MS} millis`);
            continue;
          }
          yield* Ref.set(activeTargetRef, target);

          const attacked = yield* combat.attackMonster({ monMapId: target });

          const cast = attacked
            ? yield* castNextCombatProfileStep(runtimeDeps, profile, cursor)
            : false;

          yield* clearLastError;

          const delayMs =
            attacked && cast
              ? Math.max(MIN_LOOP_DELAY_MS, profile.delayMs)
              : IDLE_DELAY_MS;
          yield* Effect.sleep(`${delayMs} millis`);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            disposeMonsterDeath?.();
          }).pipe(
            Effect.andThen(
              Effect.all([combat.cancelAutoAttack(), combat.cancelTarget()], {
                discard: true,
              }),
            ),
          ),
        ),
      );
    };

    const runtimeDeps = makeCombatProfileRuntimeDeps(combat, player, players);

    const handleUpdateMessage = (event: FlashEvent) =>
      Effect.gen(function* () {
        if (event.type !== "updateMessage") {
          return;
        }

        const state = yield* Ref.get(stateRef);
        if (!state.enabled || state.profile === undefined) {
          return;
        }

        const triggers = state.profile.messageTriggers ?? [];
        if (triggers.length === 0) {
          return;
        }

        const now = Date.now();
        for (const trigger of triggers) {
          if (!matchesCombatProfileMessageTrigger(trigger, event.payload)) {
            continue;
          }

          const cast = yield* castCombatProfileMessageTrigger(
            runtimeDeps,
            state.profile,
            trigger,
            event.payload,
            messageTriggerState,
            now,
          );
          if (cast) {
            yield* clearLastError;
          }
        }
      });

    const enable: AutoAttackShape["enable"] = (options) =>
      updateSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(stateRef);
          if (current.enabled) {
            return yield* snapshot();
          }

          const profile = getCombatProfileById(
            options.library,
            options.profileId,
          );
          const targetPlan = {
            snapshotTarget: yield* snapshotTarget,
            targetPriority: [...(options.targetPriority ?? [])],
          };
          yield* Ref.set(stateRef, {
            enabled: true,
            lastError: undefined,
            profile,
          });
          yield* Ref.set(messageTriggerState.state, new Map());

          const started = yield* jobs.start(
            AUTO_ATTACK_JOB_KEY,
            loop(profile, targetPlan).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause)
                  : stopAfterUnexpectedFailure(profile, cause).pipe(
                      Effect.andThen(Effect.failCause(cause)),
                    ),
              ),
            ),
            { replace: true },
          );
          if (!started) {
            yield* Ref.set(stateRef, current);
            yield* setLastError("Failed to start auto attack");
            return yield* snapshot();
          }

          const state = yield* snapshot();
          yield* listeners.emit(state);
          return state;
        }),
      );

    const disable: AutoAttackShape["disable"] = () =>
      updateSemaphore.withPermits(1)(
        Effect.gen(function* () {
          yield* Ref.update(stateRef, (state) => ({
            ...state,
            enabled: false,
            lastError: undefined,
            profile: undefined,
          }));
          yield* Ref.set(messageTriggerState.state, new Map());
          yield* jobs.stop(AUTO_ATTACK_JOB_KEY);
          yield* combat.cancelAutoAttack();
          yield* combat.cancelTarget();

          const state = yield* snapshot();
          yield* listeners.emit(state);
          return state;
        }),
      );

    yield* Effect.addFinalizer(() => disable().pipe(Effect.asVoid));

    const disposeUpdateMessage = yield* events.on(
      { kind: "projection", type: "updateMessage" },
      handleUpdateMessage,
    );
    yield* Effect.addFinalizer(() => Effect.sync(disposeUpdateMessage));

    return AutoAttack.of({
      disable,
      enable,
      getState: () => snapshot(),
      isEnabled: () =>
        Ref.get(stateRef).pipe(Effect.map((state) => state.enabled)),
      onState: (listener, options) =>
        listeners.on(snapshot(), listener, options),
    });
  }),
);
