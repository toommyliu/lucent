import {
  Cause,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";

import type { ScriptFile } from "../../../shared/ipc/scripting";
import type { ScriptInputValues } from "@lucent/core/scriptInputs";
import { ArmyApi } from "../army/Army";
import { Automation } from "../automation/Automation";
import { Api } from "../flash/api/Api";
import { Bridge } from "../flash/bridge/Bridge";
import type { Event as FlashEvent } from "../flash/contract/Event";
import type {
  ScriptMain,
  ScriptRuntimeApi,
  ScriptRuntimeOptions,
} from "./ScriptApi";
import {
  makeScriptAsyncScope,
  type ScriptAsyncScope,
} from "./scriptAsyncScope";
import { loadScriptModule } from "./scriptLoader";
import {
  makeScriptLucentStd,
  type ScriptRuntimeServices,
} from "./ScriptRuntimeStd";
import {
  ScriptExecutionError,
  ScriptNotReadyError,
  ScriptStopSignal,
} from "./ScriptRunnerErrors";

export type ScriptRunnerStatus =
  | { readonly state: "idle" }
  | {
      readonly name: string;
      readonly path?: string;
      readonly startedAt: string;
      readonly state: "starting";
    }
  | {
      readonly name: string;
      readonly path?: string;
      readonly startedAt: string;
      readonly state: "running";
    }
  | {
      readonly completedAt: string;
      readonly name: string;
      readonly path?: string;
      readonly state: "completed";
    }
  | {
      readonly detailsText?: string;
      readonly failedAt: string;
      readonly message: string;
      readonly name: string;
      readonly path?: string;
      readonly state: "failed";
    }
  | {
      readonly reason?: string;
      readonly state: "stopped";
      readonly stoppedAt: string;
    }
  | {
      readonly name: string;
      readonly path?: string;
      readonly state: "stopping";
    };

export type StateDisposer = () => void;

export interface ScriptRunnerShape {
  readonly getOptions: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly getStatus: () => Effect.Effect<ScriptRunnerStatus>;
  readonly isRunning: () => Effect.Effect<boolean>;
  readonly onStatus: (
    listener: (status: ScriptRunnerStatus) => void,
  ) => Effect.Effect<StateDisposer>;
  readonly onOptions: (
    listener: (options: ScriptRuntimeOptions) => void,
  ) => Effect.Effect<StateDisposer>;
  readonly resetOptions: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly setSafeStartStop: (
    enabled: boolean,
  ) => Effect.Effect<ScriptRuntimeOptions>;
  readonly setUsePrivateRooms: (
    enabled: boolean,
  ) => Effect.Effect<ScriptRuntimeOptions>;
  readonly start: (
    file: ScriptFile,
    inputs: ScriptInputValues,
  ) => Effect.Effect<ScriptRunnerStatus>;
  readonly stop: (reason?: string) => Effect.Effect<ScriptRunnerStatus>;
}

export class ScriptRunner extends Context.Service<
  ScriptRunner,
  ScriptRunnerShape
>()("lucent/game/scripting/ScriptRunner") {}

interface ActiveScript {
  readonly fiber: Fiber.Fiber<void, unknown>;
  readonly id: number;
  readonly name: string;
  readonly path?: string;
  readonly scope: ScriptAsyncScope;
}

interface PendingFinalization {
  readonly done: Deferred.Deferred<ScriptRunnerStatus>;
  readonly id: number;
}

interface StartingCancellation {
  readonly reason?: string;
}

interface StartingScript {
  readonly cancel: Deferred.Deferred<StartingCancellation>;
  readonly commandId: number;
  readonly done: Deferred.Deferred<ScriptRunnerStatus>;
  readonly id: number;
  readonly name: string;
  readonly path?: string;
}

const defaultOptions: ScriptRuntimeOptions = {
  safeStartStop: true,
  usePrivateRooms: true,
};

const nowIso = (): string => new Date().toISOString();

const snapshotOptions = (
  options: ScriptRuntimeOptions,
): ScriptRuntimeOptions => ({ ...options });

const snapshotStatus = (status: ScriptRunnerStatus): ScriptRunnerStatus => ({
  ...status,
});

const statusName = (file: Pick<ScriptFile, "name" | "path">) =>
  file.name.trim() === "" ? (file.path ?? "script") : file.name;

const activeStatusFields = (active: Pick<ActiveScript, "name" | "path">) => ({
  name: active.name,
  ...(active.path === undefined ? {} : { path: active.path }),
});

type ScriptTermination =
  | { readonly kind: "failed" }
  | { readonly kind: "stopped"; readonly reason?: string };

const classifyScriptTermination = (
  cause: Cause.Cause<unknown>,
): ScriptTermination => {
  let stopReason: string | undefined;
  let sawStopSignal = false;

  for (const reason of cause.reasons) {
    if (Cause.isInterruptReason(reason)) {
      continue;
    }

    if (
      Cause.isFailReason(reason) &&
      reason.error instanceof ScriptStopSignal
    ) {
      sawStopSignal = true;
      stopReason ??= reason.error.reason;
      continue;
    }

    return { kind: "failed" };
  }

  return sawStopSignal || Cause.hasInterruptsOnly(cause)
    ? {
        kind: "stopped",
        ...(stopReason === undefined ? {} : { reason: stopReason }),
      }
    : { kind: "failed" };
};

const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error && squashed.message.length > 0
    ? squashed.message
    : Cause.pretty(cause);
};

const causeDetailsText = (cause: Cause.Cause<unknown>): string | undefined => {
  const squashed = Cause.squash(cause);
  if (squashed instanceof Error && squashed.stack?.trim() !== "") {
    return squashed.stack;
  }

  const pretty = Cause.pretty(cause);
  return pretty.trim() === "" ? undefined : pretty;
};

const logScriptFailureCause = (
  cause: Cause.Cause<unknown>,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const squashed = Cause.squash(cause);
    console.error(
      "[script]",
      "error running script:",
      squashed instanceof Error ? squashed : causeMessage(cause),
    );
  });

const isConnectionLoss = (event: FlashEvent): boolean =>
  event.type === "connection" &&
  (event.status === "OnConnectionLost" ||
    event.status === "OnConnectionFailed");

export const layer = Layer.effect(
  ScriptRunner,
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    const api = yield* Api;
    const army = yield* ArmyApi;
    const automation = yield* Automation;
    const bridge = yield* Bridge;
    const {
      auth,
      bank,
      combat,
      drops,
      events,
      house,
      inventory,
      map,
      monsters,
      packet,
      player,
      players,
      quests,
      settings,
      shops,
      tempInventory,
      wait,
    } = api;
    const { autoRelogin, autoZone } = automation;

    const services: ScriptRuntimeServices = {
      army,
      auth,
      bank,
      combat,
      drops,
      events,
      house,
      inventory,
      map,
      monsters,
      packet,
      player,
      players,
      quests,
      settings,
      shops,
      tempInventory,
      wait,
    };

    const activeRef = yield* Ref.make<ActiveScript | null>(null);
    const lifecycleGate = yield* Semaphore.make(1);
    const latestCommandIdRef = yield* Ref.make(0);
    const nextIdRef = yield* Ref.make(0);
    const pendingFinalizationRef = yield* Ref.make<PendingFinalization | null>(
      null,
    );
    const startingRef = yield* Ref.make<StartingScript | null>(null);
    const optionsRef =
      yield* SubscriptionRef.make<ScriptRuntimeOptions>(defaultOptions);
    const statusRef = yield* SubscriptionRef.make<ScriptRunnerStatus>({
      state: "idle",
    });

    const getStatus = () =>
      SubscriptionRef.get(statusRef).pipe(Effect.map(snapshotStatus));

    const setStatus = (status: ScriptRunnerStatus) =>
      SubscriptionRef.set(statusRef, snapshotStatus(status));

    const getOptions = () =>
      SubscriptionRef.get(optionsRef).pipe(Effect.map(snapshotOptions));

    const setOptions = (
      update: (options: ScriptRuntimeOptions) => ScriptRuntimeOptions,
    ) =>
      SubscriptionRef.updateAndGet(optionsRef, (options) =>
        snapshotOptions(update(options)),
      ).pipe(Effect.map(snapshotOptions));

    const observe = <A>(
      changes: Stream.Stream<A>,
      snapshot: (value: A) => A,
      listener: (value: A) => void,
    ) =>
      changes.pipe(
        Stream.runForEach((value) =>
          Effect.sync(() => listener(snapshot(value))),
        ),
        Effect.forkIn(scope),
        Effect.map((fiber) => () => {
          runFork(Fiber.interrupt(fiber));
        }),
      );

    const awaitStatus = (done: Deferred.Deferred<ScriptRunnerStatus>) =>
      Deferred.await(done).pipe(Effect.map(snapshotStatus));

    const requestInterrupt = Effect.fn("ScriptRunner.requestInterrupt")(
      function* (fiber: Fiber.Fiber<void, unknown>) {
        const interruptor = yield* Effect.fiberId;
        yield* Effect.sync(() => {
          // Request cancellation synchronously; the owning finalizer awaits
          // termination before releasing script resources.
          fiber.interruptUnsafe(interruptor);
        });
      },
    );

    interface FinalizationOptions {
      readonly active: ActiveScript;
      readonly awaitFiber: boolean;
      readonly cause?: Cause.Cause<unknown>;
      readonly done: PendingFinalization["done"];
      readonly terminalStatus: () => ScriptRunnerStatus;
    }

    const completeFinalization = Effect.fn("ScriptRunner.completeFinalization")(
      function* (
        id: number,
        done: PendingFinalization["done"],
        status: ScriptRunnerStatus,
      ) {
        yield* lifecycleGate.withPermit(
          Effect.gen(function* () {
            const pending = yield* Ref.get(pendingFinalizationRef);
            if (pending?.id !== id || pending.done !== done) {
              yield* Deferred.succeed(done, yield* getStatus());
              return;
            }

            yield* Ref.set(pendingFinalizationRef, null);
            yield* setStatus(status);
            yield* Deferred.succeed(done, snapshotStatus(status));
          }),
        );
      },
    );

    const finalize = Effect.fn("ScriptRunner.finalize")(function* (
      options: FinalizationOptions,
    ) {
      if (options.awaitFiber) {
        yield* Fiber.await(options.active.fiber);
      }
      yield* options.active.scope.close;
      if (options.cause !== undefined) {
        yield* logScriptFailureCause(options.cause);
      }
      yield* completeFinalization(
        options.active.id,
        options.done,
        options.terminalStatus(),
      );
    });

    const beginFinalization = Effect.fn("ScriptRunner.beginFinalization")(
      function* (
        active: ActiveScript,
        options: {
          readonly awaitFiber: boolean;
          readonly cause?: Cause.Cause<unknown>;
          readonly intermediateStatus?: ScriptRunnerStatus;
          readonly interrupt: boolean;
          readonly terminalStatus: () => ScriptRunnerStatus;
        },
      ) {
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const done = yield* Deferred.make<ScriptRunnerStatus>();
            yield* Ref.set(activeRef, null);
            yield* Ref.set(pendingFinalizationRef, { done, id: active.id });
            if (options.intermediateStatus !== undefined) {
              yield* setStatus(options.intermediateStatus);
            }

            yield* active.scope.cancel;
            if (options.interrupt) {
              yield* requestInterrupt(active.fiber);
            }

            yield* finalize({
              active,
              awaitFiber: options.awaitFiber,
              ...(options.cause === undefined ? {} : { cause: options.cause }),
              done,
              terminalStatus: options.terminalStatus,
            }).pipe(Effect.forkDetach);
            return done;
          }),
        );
      },
    );

    const stopActive = Effect.fn("ScriptRunner.stopActive")(function* (
      reason?: string,
    ) {
      yield* Ref.update(latestCommandIdRef, (value) => value + 1);
      const result = yield* lifecycleGate.withPermit(
        Effect.gen(function* () {
          const starting = yield* Ref.get(startingRef);
          if (starting !== null) {
            yield* Deferred.succeed(
              starting.cancel,
              reason === undefined ? {} : { reason },
            );
            return { done: starting.done, kind: "waiting" } as const;
          }

          const pending = yield* Ref.get(pendingFinalizationRef);
          if (pending !== null) {
            return { done: pending.done, kind: "waiting" } as const;
          }

          const active = yield* Ref.get(activeRef);
          if (active === null) {
            return { kind: "status", status: yield* getStatus() } as const;
          }

          const done = yield* beginFinalization(active, {
            awaitFiber: true,
            intermediateStatus: {
              ...activeStatusFields(active),
              state: "stopping",
            },
            interrupt: true,
            terminalStatus: () => ({
              ...(reason === undefined ? {} : { reason }),
              state: "stopped",
              stoppedAt: nowIso(),
            }),
          });
          return { done, kind: "waiting" } as const;
        }),
      );

      return result.kind === "status"
        ? result.status
        : yield* awaitStatus(result.done);
    });

    const finishIfActive = Effect.fn("ScriptRunner.finishIfActive")(function* (
      id: number,
      terminalStatus: () => ScriptRunnerStatus,
    ) {
      const done = yield* lifecycleGate.withPermit(
        Effect.gen(function* () {
          if ((yield* Ref.get(pendingFinalizationRef)) !== null) {
            return null;
          }
          const active = yield* Ref.get(activeRef);
          return active?.id === id
            ? yield* beginFinalization(active, {
                awaitFiber: false,
                interrupt: false,
                terminalStatus,
              })
            : null;
        }),
      );
      if (done !== null) {
        yield* awaitStatus(done);
      }
    });

    const failActiveCause = Effect.fn("ScriptRunner.failActiveCause")(
      function* (id: number, cause: Cause.Cause<unknown>) {
        const detailsText = causeDetailsText(cause);
        const done = yield* lifecycleGate.withPermit(
          Effect.gen(function* () {
            if ((yield* Ref.get(pendingFinalizationRef)) !== null) {
              return null;
            }

            const active = yield* Ref.get(activeRef);
            return active?.id === id
              ? yield* beginFinalization(active, {
                  awaitFiber: true,
                  cause,
                  interrupt: true,
                  terminalStatus: () => ({
                    ...activeStatusFields(active),
                    ...(detailsText === undefined ? {} : { detailsText }),
                    failedAt: nowIso(),
                    message: causeMessage(cause),
                    state: "failed",
                  }),
                })
              : null;
          }),
        );
        if (done !== null) {
          yield* awaitStatus(done);
        }
      },
    );

    const warnSafeStartStopFailure = (phase: "after" | "before") =>
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.logWarning({
          cause,
          message: `script safeStartStop ${phase}-run house move failed`,
        }),
      );

    const returnInfoPath = "world.returnInfo";
    const setReturnInfo = (value: unknown) =>
      bridge
        .invoke("flash.setGameObject", [returnInfoPath, value], Schema.Void)
        .pipe(Effect.map(Option.isSome));

    const moveToOwnHouse = (phase: "after" | "before") =>
      Effect.gen(function* () {
        const username = (yield* auth.getUsername()).trim();
        if (username === "") {
          yield* Effect.logWarning({
            message: `script safeStartStop ${phase}-run skipped; username is unavailable`,
          });
          return;
        }

        if (!(yield* player.isAlive())) {
          yield* Effect.logInfo({
            message: `script safeStartStop ${phase}-run waiting for automatic respawn`,
          });
          yield* wait.until(player.isAlive());
        }

        if (!(yield* combat.exit())) {
          yield* Effect.logWarning({
            message: `script safeStartStop ${phase}-run skipped; combat could not be exited`,
          });
          return;
        }

        yield* Effect.sleep("1 second");

        const move = Effect.gen(function* () {
          yield* packet.sendServer(`%xt%zm%house%1%${username}%`);
          const moved = yield* wait.until(
            Effect.gen(function* () {
              const [mapName, ready] = yield* Effect.all([
                map.getName(),
                player.isReady(),
              ]);
              return mapName.toLowerCase() === "house" && ready;
            }),
            { timeout: "5 seconds" },
          );

          if (!moved) {
            yield* Effect.logWarning({
              message: `script safeStartStop ${phase}-run house move timed out`,
            });
          }
        });

        // Clear (potentially) stale returnInfo for clean transfer.
        const returnInfoIsNull = yield* bridge.invoke(
          "flash.isNull",
          [returnInfoPath],
          Schema.Boolean,
        );
        if (Option.getOrElse(returnInfoIsNull, () => false)) return yield* move;

        const returnInfo = yield* bridge.invokeJson(
          "flash.getGameObject",
          [returnInfoPath],
          Schema.Unknown,
        );
        if (Option.isNone(returnInfo) || !(yield* setReturnInfo(null))) {
          yield* Effect.logWarning({
            message: `script safeStartStop ${phase}-run skipped; world.returnInfo could not be cleared`,
          });
          return;
        }

        yield* move.pipe(
          Effect.ensuring(setReturnInfo(returnInfo.value).pipe(Effect.asVoid)),
        );
      }).pipe(warnSafeStartStopFailure(phase));

    const runWithSafeStartStop = (main: ScriptMain) =>
      Effect.gen(function* () {
        const options = yield* SubscriptionRef.get(optionsRef);
        if (options.safeStartStop) {
          yield* moveToOwnHouse("before");
        }

        const runMain = Effect.gen(function* () {
          const iterator = main() as Generator<
            Effect.Effect<any, any, never>,
            unknown,
            any
          >;
          return yield* iterator;
        }).pipe(Effect.asVoid);

        return yield* runMain.pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) =>
              SubscriptionRef.get(optionsRef).pipe(
                Effect.flatMap((currentOptions) =>
                  currentOptions.safeStartStop
                    ? moveToOwnHouse("after")
                    : Effect.void,
                ),
                Effect.andThen(Effect.failCause(cause)),
              ),
            onSuccess: () =>
              SubscriptionRef.get(optionsRef).pipe(
                Effect.flatMap((currentOptions) =>
                  currentOptions.safeStartStop
                    ? moveToOwnHouse("after")
                    : Effect.void,
                ),
              ),
          }),
        );
      });

    const makeScriptApi = (
      scope: ScriptAsyncScope,
      inputValues: ScriptInputValues,
    ): ScriptRuntimeApi => {
      const script: ScriptRuntimeApi = {
        exit: (options) =>
          Effect.gen(function* () {
            if (options?.logout === true) {
              yield* auth.logout();
            }

            if (options?.closeWindow === true) {
              yield* Effect.sync(() => {
                window.close();
              });
            }

            return yield* new ScriptStopSignal({
              reason: "script requested exit",
            });
          }),
        inputs: {
          get: (key: string) => Effect.succeed(inputValues[key]),
          getAll: () => Effect.succeed({ ...inputValues }),
        },
        log: (message) =>
          Effect.sync(() => {
            console.log("[script]", message);
          }),
        options: {
          getAll: getOptions,
          getSafeStartStop: () =>
            SubscriptionRef.get(optionsRef).pipe(
              Effect.map((options) => options.safeStartStop),
            ),
          getUsePrivateRooms: () =>
            SubscriptionRef.get(optionsRef).pipe(
              Effect.map((options) => options.usePrivateRooms),
            ),
          reset: () => setOptions(() => defaultOptions),
          setSafeStartStop: (enabled: boolean) =>
            setOptions((options) => ({
              ...options,
              safeStartStop: enabled,
            })),
          setUsePrivateRooms: (enabled: boolean) =>
            setOptions((options) => ({
              ...options,
              usePrivateRooms: enabled,
            })),
        },
        signal: scope.signal,
        sleep: (ms) =>
          Number.isFinite(ms) && ms >= 0
            ? Effect.sleep(`${Math.trunc(ms)} millis`)
            : Effect.fail(
                new ScriptExecutionError({
                  detail: "script.sleep requires a non-negative finite number.",
                }),
              ),
        stop: (reason) =>
          Effect.fail(
            new ScriptStopSignal(reason === undefined ? {} : { reason }),
          ),
      };
      return Object.freeze(script);
    };

    const installReadinessWatcher = (id: number, scope: ScriptAsyncScope) =>
      events
        .on({ type: "connection" }, (event) =>
          isConnectionLoss(event)
            ? failActiveCause(
                id,
                Cause.fail(
                  new ScriptExecutionError({
                    detail: "Script stopped because game readiness was lost.",
                  }),
                ),
              )
            : Effect.void,
        )
        .pipe(Effect.tap((dispose) => scope.addCleanup(dispose)));

    const runScript = (id: number, file: ScriptFile, main: ScriptMain) =>
      runWithSafeStartStop(main).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) => {
            const termination = classifyScriptTermination(cause);
            if (termination.kind === "stopped") {
              return finishIfActive(id, () => ({
                ...(termination.reason === undefined
                  ? {}
                  : { reason: termination.reason }),
                state: "stopped",
                stoppedAt: nowIso(),
              }));
            }

            const detailsText = causeDetailsText(cause);
            return logScriptFailureCause(cause).pipe(
              Effect.andThen(
                finishIfActive(id, () => ({
                  ...(detailsText === undefined ? {} : { detailsText }),
                  failedAt: nowIso(),
                  message: causeMessage(cause),
                  name: statusName(file),
                  ...(file.path === undefined ? {} : { path: file.path }),
                  state: "failed",
                })),
              ),
            );
          },
          onSuccess: () =>
            finishIfActive(id, () => ({
              completedAt: nowIso(),
              name: statusName(file),
              ...(file.path === undefined ? {} : { path: file.path }),
              state: "completed",
            })),
        }),
      );

    const completeStarting = Effect.fn("ScriptRunner.completeStarting")(
      function* (starting: StartingScript, status: ScriptRunnerStatus) {
        return yield* lifecycleGate.withPermit(
          Effect.uninterruptible(
            Effect.gen(function* () {
              const current = yield* Ref.get(startingRef);
              const authoritative =
                current?.id === starting.id && current.done === starting.done
                  ? status
                  : yield* getStatus();

              if (
                current?.id === starting.id &&
                current.done === starting.done
              ) {
                yield* Ref.set(startingRef, null);
                yield* setStatus(status);
              }
              yield* Deferred.succeed(
                starting.done,
                snapshotStatus(authoritative),
              );
              return authoritative;
            }),
          ),
        );
      },
    );

    const runStarting = Effect.fn("ScriptRunner.runStarting")(function* (
      starting: StartingScript,
      file: ScriptFile,
      inputs: ScriptInputValues,
    ) {
      const scriptScope = makeScriptAsyncScope();
      let activated = false;
      let scriptFiber: Fiber.Fiber<void, unknown> | undefined;

      const cleanup = Effect.suspend(() =>
        activated
          ? Effect.void
          : Effect.uninterruptible(
              Effect.gen(function* () {
                yield* scriptScope.cancel;
                if (scriptFiber !== undefined) {
                  yield* requestInterrupt(scriptFiber);
                  yield* Fiber.await(scriptFiber);
                }
                yield* scriptScope.close;
              }),
            ),
      );

      const setup = Effect.gen(function* () {
        const loggedIn = yield* auth
          .isLoggedIn()
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        const ready = yield* player
          .isReady()
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        if (!loggedIn || !ready) {
          return yield* new ScriptNotReadyError({
            detail: "Scripts can only start after login and player readiness.",
          });
        }

        yield* scriptScope.addCleanup(() =>
          army.leave().pipe(Effect.catchCause(() => Effect.void)),
        );
        const script = makeScriptApi(scriptScope, inputs);
        const lucent = makeScriptLucentStd({
          failCause: (cause) => failActiveCause(starting.id, cause),
          features: { autoRelogin, autoZone },
          scope: scriptScope,
          script,
          services,
        });
        const loaded = yield* loadScriptModule({
          lucent,
          name: file.path ?? file.name,
          revision: file.revision,
          source: file.source,
        });
        yield* installReadinessWatcher(starting.id, scriptScope);

        const release = yield* Deferred.make<void>();
        const fiber = yield* Deferred.await(release).pipe(
          Effect.andThen(runScript(starting.id, file, loaded.main)),
          Effect.forkDetach,
        );
        scriptFiber = fiber;
        const active: ActiveScript = {
          fiber,
          id: starting.id,
          name: starting.name,
          ...(starting.path === undefined ? {} : { path: starting.path }),
          scope: scriptScope,
        };
        const status: ScriptRunnerStatus = {
          ...activeStatusFields(active),
          startedAt: nowIso(),
          state: "running",
        };

        const committed = yield* lifecycleGate.withPermit(
          Effect.uninterruptible(
            Effect.gen(function* () {
              const current = yield* Ref.get(startingRef);
              const latestCommandId = yield* Ref.get(latestCommandIdRef);
              const cancelled = yield* Deferred.isDone(starting.cancel);
              if (
                current?.id !== starting.id ||
                current.done !== starting.done ||
                latestCommandId !== starting.commandId ||
                cancelled
              ) {
                return false;
              }

              yield* Effect.sync(() => {
                activated = true;
              });
              yield* Ref.set(startingRef, null);
              yield* Ref.set(activeRef, active);
              yield* setStatus(status);
              yield* Deferred.succeed(release, undefined);
              return true;
            }),
          ),
        );
        if (!committed) {
          return yield* Effect.interrupt;
        }
        return status;
      }).pipe(Effect.ensuring(cleanup));

      const status = yield* Effect.raceFirst(
        setup.pipe(
          Effect.map((status) => ({ kind: "started", status }) as const),
        ),
        Deferred.await(starting.cancel).pipe(
          Effect.map(
            (cancellation) => ({ cancellation, kind: "cancelled" }) as const,
          ),
        ),
      ).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Effect.gen(function* () {
              if (Cause.hasInterruptsOnly(cause)) {
                const cancellation = (yield* Deferred.isDone(starting.cancel))
                  ? yield* Deferred.await(starting.cancel)
                  : { reason: "start interrupted" };
                return {
                  ...(cancellation.reason === undefined
                    ? {}
                    : { reason: cancellation.reason }),
                  state: "stopped",
                  stoppedAt: nowIso(),
                } as ScriptRunnerStatus;
              }

              yield* logScriptFailureCause(cause);
              const detailsText = causeDetailsText(cause);
              return {
                ...(detailsText === undefined ? {} : { detailsText }),
                failedAt: nowIso(),
                message: causeMessage(cause),
                name: starting.name,
                ...(starting.path === undefined ? {} : { path: starting.path }),
                state: "failed",
              } as ScriptRunnerStatus;
            }),
          onSuccess: (outcome) =>
            outcome.kind === "started"
              ? Effect.succeed<ScriptRunnerStatus>(outcome.status)
              : Effect.succeed<ScriptRunnerStatus>({
                  ...(outcome.cancellation.reason === undefined
                    ? {}
                    : { reason: outcome.cancellation.reason }),
                  state: "stopped",
                  stoppedAt: nowIso(),
                }),
        }),
      );

      yield* completeStarting(starting, status);
    });

    const beginStarting = Effect.fn("ScriptRunner.beginStarting")(function* (
      commandId: number,
      file: ScriptFile,
      inputs: ScriptInputValues,
    ) {
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const id = yield* Ref.updateAndGet(nextIdRef, (value) => value + 1);
          const cancel = yield* Deferred.make<StartingCancellation>();
          const done = yield* Deferred.make<ScriptRunnerStatus>();
          const starting: StartingScript = {
            cancel,
            commandId,
            done,
            id,
            name: statusName(file),
            ...(file.path === undefined ? {} : { path: file.path }),
          };
          yield* Ref.set(startingRef, starting);
          yield* setStatus({
            ...activeStatusFields(starting),
            startedAt: nowIso(),
            state: "starting",
          });
          yield* runStarting(starting, file, inputs).pipe(Effect.forkDetach);
          return done;
        }),
      );
    });

    const start: ScriptRunnerShape["start"] = (file, inputs) => {
      const fileSnapshot = { ...file };
      const inputSnapshot = { ...inputs };
      return Effect.gen(function* () {
        const commandId = yield* Ref.updateAndGet(
          latestCommandIdRef,
          (value) => value + 1,
        );
        while (true) {
          const result = yield* lifecycleGate.withPermit(
            Effect.gen(function* () {
              if ((yield* Ref.get(latestCommandIdRef)) !== commandId) {
                return {
                  kind: "status",
                  status: yield* getStatus(),
                } as const;
              }

              const starting = yield* Ref.get(startingRef);
              if (starting !== null) {
                yield* Deferred.succeed(starting.cancel, {
                  reason: "replaced",
                });
                return { done: starting.done, kind: "waiting" } as const;
              }

              const pending = yield* Ref.get(pendingFinalizationRef);
              if (pending !== null) {
                return { done: pending.done, kind: "waiting" } as const;
              }

              const active = yield* Ref.get(activeRef);
              if (active !== null) {
                const done = yield* beginFinalization(active, {
                  awaitFiber: true,
                  intermediateStatus: {
                    ...activeStatusFields(active),
                    state: "stopping",
                  },
                  interrupt: true,
                  terminalStatus: () => ({
                    reason: "replaced",
                    state: "stopped",
                    stoppedAt: nowIso(),
                  }),
                });
                return { done, kind: "waiting" } as const;
              }

              return {
                done: yield* beginStarting(
                  commandId,
                  fileSnapshot,
                  inputSnapshot,
                ),
                kind: "starting",
              } as const;
            }),
          );

          if (result.kind === "status") {
            return result.status;
          }
          const status = yield* awaitStatus(result.done);
          if (result.kind === "starting") {
            return status;
          }
        }
      });
    };

    const stop: ScriptRunnerShape["stop"] = (reason) => stopActive(reason);

    yield* Effect.addFinalizer(() => stop("shutdown").pipe(Effect.asVoid));

    return ScriptRunner.of({
      getOptions,
      getStatus,
      isRunning: () =>
        getStatus().pipe(
          Effect.map(
            (status) =>
              status.state === "running" ||
              status.state === "starting" ||
              status.state === "stopping",
          ),
        ),
      onOptions: (listener) =>
        observe(SubscriptionRef.changes(optionsRef), snapshotOptions, listener),
      onStatus: (listener) =>
        observe(SubscriptionRef.changes(statusRef), snapshotStatus, listener),
      resetOptions: () => setOptions(() => defaultOptions),
      setSafeStartStop: (enabled) =>
        setOptions((options) => ({ ...options, safeStartStop: enabled })),
      setUsePrivateRooms: (enabled) =>
        setOptions((options) => ({ ...options, usePrivateRooms: enabled })),
      start,
      stop,
    });
  }),
);
