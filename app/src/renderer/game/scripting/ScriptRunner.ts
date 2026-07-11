import {
  Cause,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Ref,
  Stream,
  SubscriptionRef,
} from "effect";

import type { ScriptFile } from "../../../shared/ipc/scripting";
import type { ScriptInputValues } from "@lucent/core/scriptInputs";
import { ArmyApi } from "../army/Army";
import { Automation } from "../automation/Automation";
import { Api } from "../flash/api/Api";
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
import { loadScriptModule, ScriptLoadError } from "./scriptLoader";
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
      readonly state: "running";
    }
  | {
      readonly completedAt: string;
      readonly name: string;
      readonly path?: string;
      readonly state: "completed";
    }
  | {
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
  ) => Effect.Effect<ScriptRunnerStatus, ScriptLoadError | ScriptNotReadyError>;
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

const defaultOptions: ScriptRuntimeOptions = {
  safeStartStop: true,
  usePrivateRooms: true,
};

const nowIso = (): string => new Date().toISOString();

const statusName = (file: Pick<ScriptFile, "name" | "path">) =>
  file.name.trim() === "" ? (file.path ?? "script") : file.name;

const activeStatusFields = (active: Pick<ActiveScript, "name" | "path">) => ({
  name: active.name,
  ...(active.path === undefined ? {} : { path: active.path }),
});

const stopSignalReason = (cause: Cause.Cause<unknown>): string | undefined => {
  for (const reason of cause.reasons) {
    if (
      Cause.isFailReason(reason) &&
      reason.error instanceof ScriptStopSignal
    ) {
      return reason.error.reason;
    }
  }

  return undefined;
};

const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error && squashed.message.length > 0
    ? squashed.message
    : Cause.pretty(cause);
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
    const nextIdRef = yield* Ref.make(0);
    const optionsRef =
      yield* SubscriptionRef.make<ScriptRuntimeOptions>(defaultOptions);
    const statusRef = yield* SubscriptionRef.make<ScriptRunnerStatus>({
      state: "idle",
    });

    const getStatus = () => SubscriptionRef.get(statusRef);

    const setStatus = (status: ScriptRunnerStatus) =>
      SubscriptionRef.set(statusRef, status);

    const setOptions = (
      update: (options: ScriptRuntimeOptions) => ScriptRuntimeOptions,
    ) => SubscriptionRef.updateAndGet(optionsRef, update);

    const observe = <A>(
      changes: Stream.Stream<A>,
      listener: (value: A) => void,
    ) =>
      changes.pipe(
        Stream.runForEach((value) => Effect.sync(() => listener(value))),
        Effect.forkIn(scope),
        Effect.map((fiber) => () => {
          runFork(Fiber.interrupt(fiber));
        }),
      );

    const stopActive = (reason?: string): Effect.Effect<ScriptRunnerStatus> =>
      Effect.gen(function* () {
        const active = yield* Ref.get(activeRef);
        if (active === null) {
          return yield* getStatus();
        }

        yield* setStatus({
          ...activeStatusFields(active),
          state: "stopping",
        });
        yield* active.scope.close;
        yield* Fiber.interrupt(active.fiber);
        yield* Ref.set(activeRef, null);

        const stopped: ScriptRunnerStatus = {
          ...(reason === undefined ? {} : { reason }),
          state: "stopped",
          stoppedAt: nowIso(),
        };
        yield* setStatus(stopped);
        return stopped;
      });

    const finishIfActive = (
      id: number,
      status: ScriptRunnerStatus,
      scope: ScriptAsyncScope,
    ) =>
      Effect.gen(function* () {
        yield* scope.close;
        const active = yield* Ref.get(activeRef);
        if (active?.id !== id) {
          return;
        }

        yield* Ref.set(activeRef, null);
        yield* setStatus(status);
      });

    const failActiveCause = (
      id: number,
      cause: Cause.Cause<unknown>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const active = yield* Ref.get(activeRef);
        if (active?.id !== id) {
          return;
        }

        yield* active.scope.close;
        yield* Ref.set(activeRef, null);
        yield* logScriptFailureCause(cause);
        yield* setStatus({
          ...activeStatusFields(active),
          failedAt: nowIso(),
          message: causeMessage(cause),
          state: "failed",
        });
        yield* Fiber.interrupt(active.fiber);
      });

    const warnSafeStartStopFailure = (phase: "after" | "before") =>
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.logWarning({
          cause,
          message: `script safeStartStop ${phase}-run house move failed`,
        }),
      );

    const moveToOwnHouse = (phase: "after" | "before") =>
      Effect.gen(function* () {
        const username = (yield* auth.getUsername()).trim();
        if (username === "") {
          yield* Effect.logWarning({
            message: `script safeStartStop ${phase}-run skipped; username is unavailable`,
          });
          return;
        }

        yield* combat.exit();
        yield* Effect.sleep("1 second");
        yield* packet.sendServer(`%xt%zm%house%1%${username}%`);
        yield* Effect.sleep("1 second");
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
          get: (key) => Effect.succeed(inputValues[key]),
          getAll: () => Effect.succeed({ ...inputValues }),
        },
        log: (message) =>
          Effect.sync(() => {
            console.log("[script]", message);
          }),
        options: {
          getAll: () => SubscriptionRef.get(optionsRef),
          getSafeStartStop: () =>
            SubscriptionRef.get(optionsRef).pipe(
              Effect.map((options) => options.safeStartStop),
            ),
          getUsePrivateRooms: () =>
            SubscriptionRef.get(optionsRef).pipe(
              Effect.map((options) => options.usePrivateRooms),
            ),
          reset: () =>
            SubscriptionRef.set(optionsRef, defaultOptions).pipe(
              Effect.andThen(SubscriptionRef.get(optionsRef)),
            ),
          setSafeStartStop: (enabled) =>
            setOptions((options) => ({
              ...options,
              safeStartStop: enabled,
            })),
          setUsePrivateRooms: (enabled) =>
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

    const runScript = (
      id: number,
      file: ScriptFile,
      main: ScriptMain,
      scope: ScriptAsyncScope,
    ) =>
      runWithSafeStartStop(main).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) => {
            const stoppedReason = stopSignalReason(cause);
            if (stoppedReason !== undefined || Cause.hasInterruptsOnly(cause)) {
              return finishIfActive(
                id,
                {
                  ...(stoppedReason === undefined
                    ? {}
                    : { reason: stoppedReason }),
                  state: "stopped",
                  stoppedAt: nowIso(),
                },
                scope,
              );
            }

            return logScriptFailureCause(cause).pipe(
              Effect.andThen(
                finishIfActive(
                  id,
                  {
                    failedAt: nowIso(),
                    message: causeMessage(cause),
                    name: statusName(file),
                    ...(file.path === undefined ? {} : { path: file.path }),
                    state: "failed",
                  },
                  scope,
                ),
              ),
            );
          },
          onSuccess: () =>
            finishIfActive(
              id,
              {
                completedAt: nowIso(),
                name: statusName(file),
                ...(file.path === undefined ? {} : { path: file.path }),
                state: "completed",
              },
              scope,
            ),
        }),
      );

    const start: ScriptRunnerShape["start"] = (file, inputs) =>
      Effect.gen(function* () {
        yield* stopActive("replaced");

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

        const id = yield* Ref.updateAndGet(nextIdRef, (value) => value + 1);
        const scope = makeScriptAsyncScope();
        yield* scope.addCleanup(() =>
          army.leave().pipe(Effect.catchCause(() => Effect.void)),
        );
        const script = makeScriptApi(scope, inputs);
        const lucent = makeScriptLucentStd({
          failCause: (cause) => failActiveCause(id, cause),
          features: { autoRelogin, autoZone },
          scope,
          script,
          services,
        });
        const loaded = yield* loadScriptModule({
          lucent,
          name: file.path ?? file.name,
          source: file.source,
        });
        yield* installReadinessWatcher(id, scope);

        const release = yield* Deferred.make<void>();
        const fiber = yield* Deferred.await(release).pipe(
          Effect.andThen(runScript(id, file, loaded.main, scope)),
          Effect.forkDetach,
        );
        const active: ActiveScript = {
          fiber,
          id,
          name: statusName(file),
          ...(file.path === undefined ? {} : { path: file.path }),
          scope,
        };
        yield* Ref.set(activeRef, active);

        const status: ScriptRunnerStatus = {
          ...activeStatusFields(active),
          startedAt: nowIso(),
          state: "running",
        };
        yield* setStatus(status);
        yield* Deferred.succeed(release, undefined);
        return status;
      });

    const stop: ScriptRunnerShape["stop"] = (reason) => stopActive(reason);

    yield* Effect.addFinalizer(() => stop("shutdown").pipe(Effect.asVoid));

    return ScriptRunner.of({
      getOptions: () => SubscriptionRef.get(optionsRef),
      getStatus,
      isRunning: () =>
        Ref.get(activeRef).pipe(Effect.map((active) => active !== null)),
      onOptions: (listener) =>
        observe(SubscriptionRef.changes(optionsRef), listener),
      onStatus: (listener) =>
        observe(SubscriptionRef.changes(statusRef), listener),
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
