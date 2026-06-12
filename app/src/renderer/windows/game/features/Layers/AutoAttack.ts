import { Effect, Layer, Option, Ref, Semaphore } from "effect";
import {
  findCombatProfileByRef,
  type CombatProfile,
} from "../../../../../shared/combat-profiles";
import {
  castCombatProfileAnimationTrigger,
  castNextCombatProfileStep,
  isAttackableMonster,
  makeCombatProfileCursor,
  matchesCombatProfileAnimationTriggerMessage,
  resetCombatProfileCursor,
} from "../../combatProfiles";
import { Combat } from "../../flash/Services/Combat";
import { GameEvents } from "../../flash/Services/GameEvents";
import type {
  GameAnimationMessageEvent,
  GameEventHandler,
} from "../../flash/Services/GameEvents";
import { Player } from "../../flash/Services/Player";
import { World } from "../../flash/Services/World";
import { Jobs } from "../../jobs/Services/Jobs";
import {
  AutoAttack,
  type AutoAttackShape,
  type AutoAttackStartOptions,
  type AutoAttackState,
  type AutoAttackStateListener,
} from "../Services/AutoAttack";

const AUTO_ATTACK_JOB_KEY = "features:auto-attack";
const IDLE_DELAY_MS = 250;
const MIN_LOOP_DELAY_MS = 50;

const toState = (
  enabled: boolean,
  running: boolean,
  profile: CombatProfile | undefined,
  lastError?: string,
): AutoAttackState => ({
  enabled,
  running,
  ...(profile === undefined
    ? {}
    : {
        profileId: profile.id,
        profileLabel: profile.label,
      }),
  ...(lastError === undefined || lastError === "" ? {} : { lastError }),
});

const make = Effect.gen(function* () {
  const combat = yield* Combat;
  const jobs = yield* Jobs;
  const maybeGameEvents = yield* Effect.serviceOption(GameEvents);
  const player = yield* Player;
  const world = yield* World;
  const enabledRef = yield* Ref.make(false);
  const profileRef = yield* Ref.make<CombatProfile | undefined>(undefined);
  const lastErrorRef = yield* Ref.make<string | undefined>(undefined);
  const animationTriggerLastCastRef = yield* Ref.make<
    ReadonlyMap<string, number>
  >(new Map());
  const updateSemaphore = yield* Semaphore.make(1);
  const listeners = new Set<AutoAttackStateListener>();

  const getState: AutoAttackShape["getState"] = () =>
    Effect.all({
      enabled: Ref.get(enabledRef),
      running: jobs.isRunning(AUTO_ATTACK_JOB_KEY),
      profile: Ref.get(profileRef),
      lastError: Ref.get(lastErrorRef),
    }).pipe(
      Effect.map(({ enabled, running, profile, lastError }) =>
        toState(enabled, running, profile, lastError),
      ),
    );

  const emitState = (state: AutoAttackState) =>
    Effect.gen(function* () {
      if (listeners.size === 0) {
        return;
      }

      yield* Effect.forEach(
        Array.from(listeners),
        (listener, listenerIndex) =>
          Effect.sync(() => listener(state)).pipe(
            Effect.catchCause((cause) =>
              Effect.logError({
                message: "auto attack listener failed",
                listenerIndex,
                cause,
              }),
            ),
          ),
        { discard: true },
      );
    });

  const emitCurrentState = Effect.flatMap(getState(), emitState);

  const setLastError = (message: string | undefined) =>
    Effect.gen(function* () {
      yield* Ref.set(lastErrorRef, message);
      yield* emitCurrentState;
    });

  const clearLastError = Effect.gen(function* () {
    const lastError = yield* Ref.get(lastErrorRef);
    if (lastError !== undefined) {
      yield* setLastError(undefined);
    }
  });

  const runAnimationTrigger = (
    profile: CombatProfile,
    trigger: NonNullable<CombatProfile["animationTriggers"]>[number],
    event: GameAnimationMessageEvent,
    now: number,
  ) =>
    Effect.gen(function* () {
      yield* castCombatProfileAnimationTrigger(
        profile,
        trigger,
        event,
        { state: animationTriggerLastCastRef },
        now,
      ).pipe(
        Effect.provideService(Combat, combat),
        Effect.catch((cause) =>
          setLastError(
            cause instanceof Error ? cause.message : "Animation trigger failed",
          ),
        ),
      );
    });

  const handleAnimationMessage = (event: GameAnimationMessageEvent) =>
    Effect.gen(function* () {
      if (!(yield* Ref.get(enabledRef))) {
        return;
      }

      const profile = yield* Ref.get(profileRef);
      if (profile === undefined) {
        return;
      }

      const triggers = profile.animationTriggers ?? [];
      if (triggers.length === 0) {
        return;
      }

      const now = Date.now();
      for (const trigger of triggers) {
        if (
          matchesCombatProfileAnimationTriggerMessage(
            trigger.messageIncludes,
            event.message,
          )
        ) {
          yield* runAnimationTrigger(profile, trigger, event, now);
        }
      }
    });

  const loop = (profile: CombatProfile) => {
    let disposeMonsterDeath: (() => void) | undefined;

    return Effect.gen(function* () {
      const cursor = yield* makeCombatProfileCursor();
      const lockedTargetMonMapIdRef = yield* Ref.make<number | undefined>(
        undefined,
      );
      const lastAutoSelectedMonMapIdRef = yield* Ref.make<number | undefined>(
        undefined,
      );
      disposeMonsterDeath = Option.isSome(maybeGameEvents)
        ? yield* maybeGameEvents.value.on("monsterDeath", (event) =>
            Effect.gen(function* () {
              if (profile.resetSkillIndexOnMonsterDeath !== true) {
                return;
              }

              const lockedTargetMonMapId = yield* Ref.get(
                lockedTargetMonMapIdRef,
              );
              if (
                lockedTargetMonMapId !== undefined &&
                event.monMapId !== lockedTargetMonMapId
              ) {
                return;
              }

              yield* resetCombatProfileCursor(cursor);
            }),
          )
        : undefined;

      const selectTarget = Effect.gen(function* () {
        const currentTarget = yield* combat.target.get();
        const lastAutoSelectedMonMapId = yield* Ref.get(
          lastAutoSelectedMonMapIdRef,
        );
        let lockedTargetMonMapId = yield* Ref.get(lockedTargetMonMapIdRef);

        if (
          Option.isSome(currentTarget) &&
          currentTarget.value.type === "monster" &&
          isAttackableMonster(currentTarget.value.entity) &&
          (lockedTargetMonMapId === undefined
            ? currentTarget.value.monMapId !== lastAutoSelectedMonMapId
            : currentTarget.value.monMapId !== lockedTargetMonMapId)
        ) {
          lockedTargetMonMapId = currentTarget.value.monMapId;
          yield* Ref.set(lockedTargetMonMapIdRef, lockedTargetMonMapId);
        }

        if (lockedTargetMonMapId !== undefined) {
          const lockedTarget = yield* world.monsters.get(lockedTargetMonMapId);
          if (
            Option.isSome(lockedTarget) &&
            isAttackableMonster(lockedTarget.value)
          ) {
            return {
              locked: true,
              monMapId: lockedTargetMonMapId,
            };
          }

          return undefined;
        }

        if (
          Option.isSome(currentTarget) &&
          currentTarget.value.type === "monster" &&
          isAttackableMonster(currentTarget.value.entity)
        ) {
          return {
            locked: false,
            monMapId: currentTarget.value.monMapId,
          };
        }

        const monsters = yield* world.monsters.getAvailable();
        const next = monsters.find(isAttackableMonster);
        return next === undefined
          ? undefined
          : {
              locked: false,
              monMapId: next.monMapId,
            };
      });

      while (yield* Ref.get(enabledRef)) {
        const alive = yield* player
          .isAlive()
          .pipe(Effect.catch(() => Effect.succeed(false)));

        if (!alive) {
          yield* Effect.sleep(`${IDLE_DELAY_MS} millis`);
          continue;
        }

        const target = yield* selectTarget.pipe(
          Effect.catch(() =>
            Effect.sync(
              ():
                | {
                    readonly locked: boolean;
                    readonly monMapId: number;
                  }
                | undefined => undefined,
            ),
          ),
        );

        if (target === undefined) {
          yield* Effect.sleep(`${IDLE_DELAY_MS} millis`);
          continue;
        }

        const { attacked, attackFailed } = yield* combat
          .attackMonster(target.monMapId)
          .pipe(
            Effect.map((attacked) => ({ attacked, attackFailed: false })),
            Effect.catch((error) =>
              setLastError(
                error instanceof Error ? error.message : "Failed to attack",
              ).pipe(Effect.as({ attacked: false, attackFailed: true })),
            ),
          );

        if (attacked && !target.locked) {
          yield* Ref.set(lastAutoSelectedMonMapIdRef, target.monMapId);
        }

        const { cast, castFailed } = attacked
          ? yield* castNextCombatProfileStep(profile, cursor).pipe(
              Effect.map((cast) => ({ cast, castFailed: false })),
              Effect.catch((error) =>
                setLastError(
                  error instanceof Error
                    ? error.message
                    : "Failed to use profile",
                ).pipe(Effect.as({ cast: false, castFailed: true })),
              ),
            )
          : { cast: false, castFailed: false };

        if (!attackFailed && !castFailed) {
          yield* clearLastError;
        }

        const delayMs = Math.max(
          MIN_LOOP_DELAY_MS,
          attacked && cast ? profile.delayMs : IDLE_DELAY_MS,
        );
        yield* Effect.sleep(`${delayMs} millis`);
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            disposeMonsterDeath?.();
          });
          yield* combat.cancelAutoAttack().pipe(
            Effect.andThen(combat.cancelTarget()),
            Effect.catch(() => Effect.void),
          );
        }),
      ),
    );
  };

  const resolveProfile = (options: AutoAttackStartOptions) =>
    Effect.gen(function* () {
      const className = yield* player
        .getClassName()
        .pipe(
          Effect.catch(() => Effect.sync((): string | undefined => undefined)),
        );

      return findCombatProfileByRef(
        options.library,
        options.profileRef,
        className,
      );
    });

  const enable: AutoAttackShape["enable"] = (options) =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const profile = yield* resolveProfile(options);
        const previousEnabled = yield* Ref.get(enabledRef);
        const previousProfile = yield* Ref.get(profileRef);

        yield* Ref.set(enabledRef, true);
        yield* Ref.set(profileRef, profile);
        yield* Ref.set(lastErrorRef, undefined);
        yield* Ref.set(animationTriggerLastCastRef, new Map());

        const startJob: Effect.Effect<boolean, unknown> = jobs.start(
          AUTO_ATTACK_JOB_KEY,
          loop(profile).pipe(
            Effect.provideService(Combat, combat),
            Effect.provideService(Player, player),
            Effect.provideService(World, world),
          ),
          {
            replace: true,
          },
        );
        yield* startJob.pipe(
          Effect.tapError((error) =>
            Effect.gen(function* () {
              yield* Ref.set(enabledRef, previousEnabled);
              yield* Ref.set(profileRef, previousProfile);
              yield* setLastError(
                error instanceof Error
                  ? error.message
                  : "Failed to start auto attack",
              );
            }),
          ),
        );

        const state = yield* getState();
        yield* emitState(state);
        return state;
      }),
    );

  const disable: AutoAttackShape["disable"] = () =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        yield* Ref.set(enabledRef, false);
        yield* Ref.set(animationTriggerLastCastRef, new Map());
        yield* jobs.stop(AUTO_ATTACK_JOB_KEY);
        yield* combat.cancelAutoAttack().pipe(Effect.catch(() => Effect.void));
        yield* combat.cancelTarget().pipe(Effect.catch(() => Effect.void));

        const state = yield* getState();
        yield* emitState(state);
        return state;
      }),
    );

  const onState: AutoAttackShape["onState"] = (listener, options) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        listeners.add(listener);
      });

      if (options?.emitCurrent ?? true) {
        yield* getState().pipe(
          Effect.flatMap((state) => Effect.sync(() => listener(state))),
          Effect.catchCause((cause) =>
            Effect.sync(() => listeners.delete(listener)).pipe(
              Effect.andThen(Effect.failCause(cause)),
            ),
          ),
        );
      }

      return () => {
        listeners.delete(listener);
      };
    });

  const disposeAnimationMessage = Option.isSome(maybeGameEvents)
    ? yield* maybeGameEvents.value.on(
        "animationMessage",
        handleAnimationMessage as GameEventHandler<"animationMessage">,
      )
    : undefined;

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposeAnimationMessage?.();
    }),
  );
  yield* Effect.addFinalizer(() => disable().pipe(Effect.asVoid));

  return {
    getState,
    onState,
    enable,
    disable,
  } satisfies AutoAttackShape;
});

export const AutoAttackLive = Layer.effect(AutoAttack, make);
