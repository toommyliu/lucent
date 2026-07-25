import {
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  getCombatProfileById,
  type CombatProfile,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import {
  DEFAULT_FOLLOWER_ATTEMPTS,
  normalizeFollowerConfig,
  type FollowerConfig,
  type FollowerPhase,
  type FollowerState,
} from "@lucent/core/follower";
import type { Player as GamePlayer } from "@lucent/game";
import {
  Cause,
  Deferred,
  Effect,
  FiberMap,
  Option,
  Queue,
  Ref,
  Schedule,
  Semaphore,
  Stream,
  SubscriptionRef,
  type FiberMap as FiberMapType,
} from "effect";

import type { DesktopGameFollowerBridge } from "../../../../shared/desktopBridge";
import type {
  FollowerCommand,
  FollowerCommandOutcome,
} from "../../../../shared/ipc";
import {
  COMBAT_PROFILE_RETRY_DELAY_MS,
  makeCombatProfileRunner,
  type CombatProfileRunner,
} from "./combat/CombatProfileRunner";
import type { ApiService } from "../flash/api/Api";

const fiberKey = "follower";
const copyWalkFiberKey = "follower-copy-walk";
const cycleIntervalMs = 500;
const sameLocationTimeout = "5 seconds";
const goToPlayerTimeout = "10 seconds";
const goToPlayerWithFallbackTimeout = "3 seconds";
const followerRetrySchedule = Schedule.exponential("500 millis").pipe(
  Schedule.either(Schedule.spaced("8 seconds")),
);

type FollowResult =
  | { readonly ok: true }
  | {
      readonly error: string;
      readonly ok: false;
      readonly reason: string;
      readonly retry: boolean;
    };

type FallbackResult =
  | { readonly reached: true }
  | {
      readonly error?: string;
      readonly reached: false;
      readonly reason?: string;
    };

interface RuntimeState {
  readonly attemptsRemaining: number;
  readonly config: FollowerConfig | undefined;
  readonly enabled: boolean;
  readonly lastError: string | undefined;
  readonly phase: FollowerPhase;
  readonly profile: CombatProfile | undefined;
  readonly runId: number;
  readonly running: boolean;
  readonly stoppedReason: string | undefined;
}

interface Position {
  readonly x: number;
  readonly y: number;
}

export interface FollowerStartOptions {
  readonly config: FollowerConfig;
  readonly library: CombatProfileLibrary;
}

export interface FollowerDesktopPort {
  readonly getCombatProfiles: () => Promise<CombatProfileLibrary>;
  readonly onCommand: DesktopGameFollowerBridge["onCommand"];
  readonly publishPlayers: DesktopGameFollowerBridge["publishPlayers"];
  readonly publishState: DesktopGameFollowerBridge["publishState"];
}

const publicState = (state: RuntimeState): FollowerState => ({
  enabled: state.enabled,
  running: state.running,
  targetName: state.config?.targetName ?? "",
  ...(state.profile === undefined
    ? {}
    : {
        profileId: state.profile.id,
        profileLabel: state.profile.label,
      }),
  phase: state.phase,
  attemptsRemaining: state.attemptsRemaining,
  ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
  ...(state.stoppedReason === undefined
    ? {}
    : { stoppedReason: state.stoppedReason }),
});

const sameText = (left: string, right: string): boolean =>
  left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

export const normalizeFollowerPlayerNames = (
  names: readonly string[],
): readonly string[] => {
  const seen = new Set<string>();
  const players: string[] = [];
  for (const name of names) {
    const player = name.trim();
    const key = player.toLocaleLowerCase();
    if (player === "" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    players.push(player);
  }
  return players.toSorted((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "accent",
    }),
  );
};

const samePlayerNames = (
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean =>
  left !== undefined &&
  left.length === right.length &&
  left.every((player, index) => player === right[index]);

const sameLocation = (left: GamePlayer, right: GamePlayer): boolean =>
  sameText(left.cell, right.cell) && sameText(left.pad, right.pad);

const hasUsablePosition = (position: Position): boolean =>
  Number.isFinite(position.x) &&
  Number.isFinite(position.y) &&
  (position.x !== 0 || position.y !== 0);

const samePosition = (left: Position, right: Position): boolean =>
  left.x === right.x && left.y === right.y;

const causeMessage = (
  cause: Cause.Cause<unknown>,
  fallback: string,
): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error && squashed.message !== ""
    ? squashed.message
    : fallback;
};

export const resolveFollowerFallbackMap = (
  map: string,
  roomOverride: string,
): string => {
  const destination = map.trim();
  const room = roomOverride.trim();
  return destination === "" || room === "" || destination.includes("-")
    ? destination
    : `${destination}-${room}`;
};

export const followerGoToTimeout = (
  retryEnabled: boolean,
  fallbackCount: number,
): typeof goToPlayerTimeout | typeof goToPlayerWithFallbackTimeout =>
  retryEnabled && fallbackCount > 0
    ? goToPlayerWithFallbackTimeout
    : goToPlayerTimeout;

const packetMessage = (data: unknown): string =>
  Array.isArray(data) && typeof data[3] === "string" ? data[3] : "";

const lockedZoneWarning = (message: string): boolean =>
  message.trim().toLowerCase() === "cannot goto player in a locked zone.";

const roomFullWarning = (message: string): boolean =>
  message.trim().toLowerCase() ===
  "room join failed, destination room is full.";

const ignoredGoToWarning = (message: string, targetName: string): boolean => {
  const text = message.trim().toLowerCase();
  const suffix = " is ignoring goto requests.";
  return (
    text.endsWith(suffix) && sameText(text.slice(0, -suffix.length), targetName)
  );
};

const makeInitialState = (): RuntimeState => ({
  attemptsRemaining: DEFAULT_FOLLOWER_ATTEMPTS,
  config: undefined,
  enabled: false,
  lastError: undefined,
  phase: "idle",
  profile: undefined,
  runId: 0,
  running: false,
  stoppedReason: undefined,
});

export const makeFollower = Effect.fnUntraced(function* (
  api: ApiService,
  fibers: FiberMapType.FiberMap<string>,
  port?: FollowerDesktopPort,
) {
  const scope = yield* Effect.scope;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const state = yield* SubscriptionRef.make<RuntimeState>(makeInitialState());
  const updateSemaphore = yield* Semaphore.make(1);
  const wakeups = yield* Queue.sliding<void>(1);
  const deniedTarget = yield* Ref.make<string | undefined>(undefined);
  const lastWalkTarget = yield* Ref.make<Position | undefined>(undefined);

  const resetRunState = Effect.gen(function* () {
    yield* FiberMap.remove(fibers, copyWalkFiberKey);
    yield* Ref.set(deniedTarget, undefined);
    yield* Ref.set(lastWalkTarget, undefined);
    yield* Queue.clear(wakeups);
  });

  const cancelCombat = Effect.gen(function* () {
    yield* api.combat
      .cancelAutoAttack()
      .pipe(Effect.catchCause(() => Effect.void));
    yield* api.combat.cancelTarget().pipe(Effect.catchCause(() => Effect.void));
  });

  const getState = () =>
    SubscriptionRef.get(state).pipe(Effect.map(publicState));

  const changes = SubscriptionRef.changes(state).pipe(Stream.map(publicState));

  const updateForRun = (
    runId: number,
    update: (current: RuntimeState) => RuntimeState,
  ) =>
    SubscriptionRef.update(state, (current) =>
      current.runId === runId ? update(current) : current,
    );

  const setPhase = (runId: number, phase: FollowerPhase) =>
    updateForRun(runId, (current) => ({ ...current, phase }));

  const setLastError = (runId: number, lastError: string | undefined) =>
    updateForRun(runId, (current) => ({ ...current, lastError }));

  const getSelf = () => api.players.getMe();
  const getTarget = (config: FollowerConfig) =>
    api.players.get(config.targetName);
  const targetsSelf = (
    self: GamePlayer | null,
    config: FollowerConfig,
  ): boolean => self !== null && sameText(self.username, config.targetName);

  const atTarget = (config: FollowerConfig) =>
    Effect.all({
      self: getSelf(),
      target: getTarget(config),
    }).pipe(
      Effect.map(
        ({ self, target }) =>
          targetsSelf(self, config) ||
          (self !== null && target !== null && sameLocation(self, target)),
      ),
    );

  const moveToVisibleTarget = (config: FollowerConfig) =>
    Effect.gen(function* () {
      const self = yield* getSelf();
      const target = yield* getTarget(config);
      if (self === null || target === null) {
        return false;
      }
      if (!sameLocation(self, target)) {
        yield* api.player.jumpToCell(target.cell, target.pad);
      }
      return yield* api.wait.until(atTarget(config), {
        timeout: sameLocationTimeout,
      });
    });

  const tryFallbacks = (runId: number, config: FollowerConfig) =>
    Effect.gen(function* () {
      if (!config.retryEnabled || config.lockedZoneFallbacks.length === 0) {
        return { reached: false };
      }

      for (const fallback of config.lockedZoneFallbacks) {
        const roomFull = yield* Deferred.make<void>();
        const disposeWarning = yield* api.packet.on(
          {
            command: "warning",
            direction: "server",
            wireType: "str",
          },
          (packet) =>
            roomFullWarning(packetMessage(packet.data))
              ? Deferred.succeed(roomFull, undefined).pipe(Effect.asVoid)
              : Effect.void,
        );

        yield* setPhase(runId, "following");
        const joined = yield* Effect.raceFirst(
          api.player.joinMap(
            resolveFollowerFallbackMap(fallback, config.lockedZoneRoomOverride),
          ),
          Deferred.await(roomFull).pipe(Effect.as(false)),
        ).pipe(
          Effect.catchCause(() => Effect.succeed(false)),
          Effect.ensuring(Effect.sync(disposeWarning)),
        );
        if (!joined) {
          continue;
        }

        const lateRoomFull = yield* Deferred.await(roomFull).pipe(
          Effect.timeoutOption("100 millis"),
          Effect.map(Option.isSome),
        );
        if (!lateRoomFull && (yield* moveToVisibleTarget(config))) {
          return { reached: true };
        }
      }

      return {
        error: "Destination room is full or unreachable",
        reached: false,
        reason: "Room join failed",
      };
    });

  const relocateToTarget = (runId: number, config: FollowerConfig) =>
    Effect.gen(function* () {
      const knownDenied = sameText(
        (yield* Ref.get(deniedTarget)) ?? "",
        config.targetName,
      );
      if (!knownDenied) {
        const denied = yield* Deferred.make<void>();
        const disposeWarning = yield* api.packet.on(
          {
            command: "warning",
            direction: "server",
            wireType: "str",
          },
          (packet) =>
            lockedZoneWarning(packetMessage(packet.data))
              ? Deferred.succeed(denied, undefined).pipe(Effect.asVoid)
              : Effect.void,
        );
        const disposeServer = yield* api.packet.on(
          {
            command: "server",
            direction: "server",
            wireType: "str",
          },
          (packet) =>
            ignoredGoToWarning(packetMessage(packet.data), config.targetName)
              ? Deferred.succeed(denied, undefined).pipe(Effect.asVoid)
              : Effect.void,
        );

        const outcome = yield* Effect.gen(function* () {
          yield* api.player.goToPlayer(config.targetName);
          return yield* Effect.raceFirst(
            api.wait
              .until(atTarget(config), {
                timeout: followerGoToTimeout(
                  config.retryEnabled,
                  config.lockedZoneFallbacks.length,
                ),
              })
              .pipe(
                Effect.map(
                  (reached) =>
                    ({
                      kind: "completed",
                      reached,
                    }) as const,
                ),
              ),
            Deferred.await(denied).pipe(Effect.as({ kind: "denied" } as const)),
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed({
              error: causeMessage(cause, "Failed to go to target"),
              kind: "failed",
            } as const),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              disposeWarning();
              disposeServer();
            }),
          ),
        );
        if (
          (outcome.kind === "completed" && outcome.reached) ||
          (yield* atTarget(config))
        ) {
          yield* Ref.set(deniedTarget, undefined);
          return { reached: true };
        }

        if (outcome.kind === "denied") {
          yield* Ref.set(deniedTarget, config.targetName);
        }

        const fallback = yield* tryFallbacks(runId, config);
        return outcome.kind === "failed" &&
          !fallback.reached &&
          fallback.error === undefined
          ? {
              error: outcome.error,
              reached: false,
              reason: "Failed to follow target",
            }
          : fallback;
      }

      return yield* tryFallbacks(runId, config);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed({
          error: causeMessage(cause, "Failed to follow target"),
          reached: false,
          reason: "Failed to follow target",
        } satisfies FallbackResult),
      ),
    );

  const copyTargetWalk = (
    runId: number,
    position: Position,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state);
      if (
        current.runId !== runId ||
        !current.enabled ||
        current.config?.copyWalk !== true ||
        !hasUsablePosition(position)
      ) {
        return;
      }

      const previous = yield* Ref.get(lastWalkTarget);
      if (previous !== undefined && samePosition(previous, position)) {
        return;
      }

      yield* setPhase(runId, "walking");
      if (yield* api.player.walkTo(position.x, position.y)) {
        yield* Ref.set(lastWalkTarget, position);
      }
    }).pipe(
      Effect.catchCause(() => Effect.void),
      Effect.asVoid,
    );

  const scheduleCopyTargetWalk = (runId: number, position: Position) => {
    return hasUsablePosition(position)
      ? FiberMap.run(
          fibers,
          copyWalkFiberKey,
          copyTargetWalk(runId, {
            ...position,
          }),
        )
      : Effect.void;
  };

  const followTarget = (
    runId: number,
    config: FollowerConfig,
  ): Effect.Effect<FollowResult> =>
    Effect.gen(function* () {
      if (
        !(yield* api.player
          .isReady()
          .pipe(Effect.catchCause(() => Effect.succeed(false))))
      ) {
        return { ok: true } as const;
      }

      let self = yield* getSelf();
      if (self === null || targetsSelf(self, config)) {
        return { ok: true } as const;
      }

      let target = yield* getTarget(config);
      if (target === null) {
        yield* setPhase(runId, "following");
        yield* api.combat.exit().pipe(Effect.catchCause(() => Effect.void));
        const relocation = yield* relocateToTarget(runId, config);
        if (!relocation.reached) {
          return {
            error:
              relocation.error ??
              (config.lockedZoneFallbacks.length === 0
                ? `Could not find ${config.targetName}`
                : `Could not find ${config.targetName} in configured locked-zone locations`),
            ok: false,
            reason: relocation.reason ?? "Target not found",
            retry: true,
          } as const;
        }
        self = yield* getSelf();
        target = yield* getTarget(config);
      }

      if (self === null || target === null) {
        return {
          error: `Could not find ${config.targetName}`,
          ok: false,
          reason: "Target not found",
          retry: true,
        } as const;
      }

      yield* Ref.set(deniedTarget, undefined);
      if (!sameLocation(self, target)) {
        yield* setPhase(runId, "following");
        yield* api.player.jumpToCell(target.cell, target.pad);
        if (
          !(yield* api.wait.until(atTarget(config), {
            timeout: sameLocationTimeout,
          }))
        ) {
          return {
            error: `Could not reach ${config.targetName}`,
            ok: false,
            reason: "Failed to follow target",
            retry: true,
          } as const;
        }
      }

      return { ok: true } as const;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed({
          error: causeMessage(cause, "Failed to follow target"),
          ok: false,
          reason: "Failed to follow target",
          retry: true,
        } as const),
      ),
    );

  const stopFromLoop = (runId: number, reason: string, error?: string) =>
    updateForRun(runId, (current) => ({
      ...current,
      enabled: false,
      lastError: error,
      phase: "stopped",
      stoppedReason: reason,
    }));

  const runCombat = (runId: number, runner: CombatProfileRunner) =>
    runner
      .runCycle({
        beforeAttack: () => setPhase(runId, "combat"),
      })
      .pipe(
        Effect.tap((result) =>
          result.kind === "attacked"
            ? setLastError(runId, undefined)
            : Effect.void,
        ),
        Effect.map((result) => result.delayMs),
        Effect.catch((failure) =>
          failure.stage === "attack"
            ? setLastError(runId, failure.message || "Failed to attack").pipe(
                Effect.as(COMBAT_PROFILE_RETRY_DELAY_MS),
              )
            : stopFromLoop(
                runId,
                "Combat profile failed",
                failure.message || "Combat profile failed",
              ).pipe(Effect.as(COMBAT_PROFILE_RETRY_DELAY_MS)),
        ),
      );

  const handleFailure = (
    runId: number,
    config: FollowerConfig,
    failure: Extract<FollowResult, { readonly ok: false }>,
  ) =>
    Effect.gen(function* () {
      if (!failure.retry || !config.retryEnabled) {
        yield* stopFromLoop(runId, failure.reason, failure.error);
        return false;
      }

      const remaining = yield* SubscriptionRef.modify(
        state,
        (current): readonly [number, RuntimeState] => {
          if (current.runId !== runId) {
            return [0, current];
          }
          const attemptsRemaining = Math.max(0, current.attemptsRemaining - 1);
          return [
            attemptsRemaining,
            {
              ...current,
              attemptsRemaining,
              lastError: failure.error,
            },
          ];
        },
      );
      if (remaining === 0) {
        yield* stopFromLoop(runId, failure.reason, failure.error);
        return false;
      }

      return yield* Effect.fail(failure);
    });

  const clearFailure = (runId: number, config: FollowerConfig) =>
    updateForRun(runId, (current) => ({
      ...current,
      attemptsRemaining: config.retryEnabled ? config.maxAttempts : 0,
      lastError: undefined,
      stoppedReason: undefined,
    }));

  const runCycle = (
    runId: number,
    config: FollowerConfig,
    runner: CombatProfileRunner | undefined,
  ) =>
    Effect.gen(function* () {
      const followed = yield* followTarget(runId, config).pipe(
        Effect.flatMap((result) =>
          result.ok
            ? clearFailure(runId, config).pipe(Effect.as(true))
            : handleFailure(runId, config, result),
        ),
        Effect.retry(followerRetrySchedule),
      );
      if (!followed) {
        return cycleIntervalMs;
      }

      if (runner === undefined) {
        return cycleIntervalMs;
      }
      return yield* runCombat(runId, runner);
    });

  const loop = (
    runId: number,
    profile: CombatProfile,
    config: FollowerConfig,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const runner = config.combatEnabled
          ? yield* makeCombatProfileRunner(api, {
              onAsyncFailure: (failure) =>
                setLastError(
                  runId,
                  failure.message || "Message trigger failed",
                ).pipe(
                  Effect.andThen(
                    Effect.logError({
                      cause: failure.failureCause,
                      message: "Follower message trigger failed",
                    }),
                  ),
                ),
              profile,
              targetPriority: config.attackPriority,
            })
          : undefined;

        while (true) {
          const current = yield* SubscriptionRef.get(state);
          if (!current.enabled || current.runId !== runId) {
            return;
          }
          const delayMs = yield* runCycle(runId, config, runner);
          yield* Effect.raceFirst(Effect.sleep(delayMs), Queue.take(wakeups));
        }
      }),
    ).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          if (current.runId !== runId) {
            return;
          }
          yield* FiberMap.remove(fibers, copyWalkFiberKey);
          yield* SubscriptionRef.update(
            state,
            (active): RuntimeState => ({
              ...active,
              enabled: false,
              phase: "stopped",
              running: false,
            }),
          );
          yield* cancelCombat;
        }),
      ),
    );

  const configure = (incoming: FollowerConfig) =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (current.enabled || current.running) {
          return yield* getState();
        }

        yield* SubscriptionRef.set(state, {
          ...current,
          config: normalizeFollowerConfig(incoming),
          lastError: undefined,
          profile: undefined,
          stoppedReason: undefined,
        });
        return yield* getState();
      }),
    );

  const start = (options: FollowerStartOptions) =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const config = normalizeFollowerConfig(options.config);
        const current = yield* SubscriptionRef.get(state);
        const runId = current.runId + 1;
        if (config.targetName === "") {
          yield* SubscriptionRef.set(state, {
            ...current,
            config,
            enabled: false,
            lastError: "Target name is required",
            phase: "stopped",
            runId,
            running: false,
            stoppedReason: "Target not found",
          });
          yield* FiberMap.remove(fibers, fiberKey);
          yield* resetRunState;
          yield* cancelCombat;
          return yield* getState();
        }

        const profile = getCombatProfileById(
          options.library,
          config.selectedProfileId,
        );
        yield* resetRunState;
        yield* SubscriptionRef.set(state, {
          attemptsRemaining: config.retryEnabled ? config.maxAttempts : 0,
          config,
          enabled: true,
          lastError: undefined,
          phase: "starting",
          profile,
          runId,
          running: true,
          stoppedReason: undefined,
        });
        yield* FiberMap.run(fibers, fiberKey, loop(runId, profile, config));
        return yield* getState();
      }),
    );

  const stop = (reason = "Stopped by user") =>
    updateSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        yield* SubscriptionRef.set(state, {
          ...current,
          attemptsRemaining: DEFAULT_FOLLOWER_ATTEMPTS,
          enabled: false,
          lastError: undefined,
          phase: "stopped",
          runId: current.runId + 1,
          running: false,
          stoppedReason: reason,
        });
        yield* FiberMap.remove(fibers, fiberKey);
        yield* resetRunState;
        yield* cancelCombat;
        return yield* getState();
      }),
    );

  const toggle = (library: CombatProfileLibrary) =>
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state);
      if (current.enabled || current.running) {
        return yield* stop();
      }
      if (current.config === undefined || current.config.targetName === "") {
        yield* SubscriptionRef.set(state, {
          ...current,
          enabled: false,
          lastError: "Configure follower before using the hotkey",
          phase: "stopped",
          running: false,
          stoppedReason: "Target not found",
        });
        return yield* getState();
      }
      return yield* start({ config: current.config, library });
    });

  const handleCommand = Effect.fn("Follower.handleCommand")(function* (
    command: FollowerCommand,
  ): Effect.fn.Return<FollowerCommandOutcome> {
    switch (command.kind) {
      case "configure":
        return {
          kind: command.kind,
          state: yield* configure(command.config),
        };
      case "get-state":
        return {
          kind: command.kind,
          state: yield* getState(),
        };
      case "me":
        return {
          kind: command.kind,
          username: (yield* getSelf())?.username ?? "",
        };
      case "start": {
        const library =
          port === undefined
            ? DEFAULT_COMBAT_PROFILE_LIBRARY
            : yield* Effect.tryPromise(() => port.getCombatProfiles()).pipe(
                Effect.catch(() =>
                  Effect.succeed(DEFAULT_COMBAT_PROFILE_LIBRARY),
                ),
              );
        return {
          kind: command.kind,
          state: yield* start({ config: command.config, library }),
        };
      }
      case "stop":
        return {
          kind: command.kind,
          state: yield* stop(),
        };
    }
  });

  const disposeLocation = yield* api.events.on(
    { type: "player-location" },
    (event) =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (
          !current.enabled ||
          current.config === undefined ||
          !sameText(event.username, current.config.targetName)
        ) {
          return;
        }

        yield* Queue.offer(wakeups, undefined);
        if (!current.config.copyWalk || event.destination === undefined) {
          return;
        }

        const [self, target] = yield* Effect.all([
          getSelf(),
          getTarget(current.config),
        ]);
        if (self !== null && target !== null && sameLocation(self, target)) {
          yield* scheduleCopyTargetWalk(current.runId, event.destination);
        }
      }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(disposeLocation));

  if (port !== undefined) {
    const playerPublishSemaphore = yield* Semaphore.make(1);
    const lastPublishedPlayers = yield* Ref.make<readonly string[] | undefined>(
      undefined,
    );
    const publishPlayers = Effect.fn("Follower.publishPlayers")(
      function* () {
        yield* playerPublishSemaphore.withPermits(1)(
          Effect.gen(function* () {
            const players = normalizeFollowerPlayerNames(
              (yield* api.players.getAll()).map((player) => player.username),
            );
            if (
              samePlayerNames(yield* Ref.get(lastPublishedPlayers), players)
            ) {
              return;
            }
            yield* Effect.tryPromise(() => port.publishPlayers(players));
            yield* Ref.set(lastPublishedPlayers, players);
          }),
        );
      },
      Effect.catchCause((cause) =>
        Effect.logWarning({
          cause,
          message: "Failed to publish follower players",
        }),
      ),
    );
    const disposePlayers = yield* api.events.on(undefined, (event) =>
      event.type === "players-changed" || event.type === "connection"
        ? publishPlayers()
        : Effect.void,
    );
    const disposeCommands = port.onCommand((command) =>
      runPromise(handleCommand(command)),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposeCommands();
        disposePlayers();
      }),
    );
    yield* publishPlayers();
    yield* changes.pipe(
      Stream.runForEach((next) =>
        Effect.tryPromise(() => port.publishState(next)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning({
              cause,
              message: "Failed to publish follower state",
            }),
          ),
        ),
      ),
      Effect.forkIn(scope),
    );
  }

  return {
    changes,
    configure,
    getState,
    start,
    stop,
    toggle,
  };
});

export type Follower = Effect.Success<ReturnType<typeof makeFollower>>;

export const makeDesktopFollowerPort = (): FollowerDesktopPort | undefined => {
  const bridge = window.desktop.gameFollower;
  if (bridge === undefined) {
    return undefined;
  }
  return {
    getCombatProfiles: () =>
      window.desktop.combatProfiles?.getState() ??
      Promise.resolve(DEFAULT_COMBAT_PROFILE_LIBRARY),
    onCommand: bridge.onCommand,
    publishPlayers: bridge.publishPlayers,
    publishState: bridge.publishState,
  };
};
