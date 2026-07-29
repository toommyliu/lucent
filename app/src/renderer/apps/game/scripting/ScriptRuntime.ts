import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DEFAULT_ACCOUNT_SETTINGS,
  RoomPolicySchema,
} from "@lucent/core/accountSettings";
import type { ScriptInputValues } from "@lucent/core/scriptInputs";
import type {
  RoomPolicy,
  ScriptRuntimeApi,
  ScriptRuntimeOptions,
} from "./ScriptApi";
import { playBeep } from "../audio/beep";
import type { ScriptAsyncScope } from "./scriptAsyncScope";
import {
  makeScriptExitSignal,
  ScriptExecutionError,
  ScriptStopSignal,
  type ScriptExitRequest,
} from "./ScriptRunnerErrors";

export const DEFAULT_SCRIPT_RUNTIME_OPTIONS: ScriptRuntimeOptions = {
  restartAfterReconnect: DEFAULT_ACCOUNT_SETTINGS.scripts.restartAfterReconnect,
  roomPolicy: DEFAULT_ACCOUNT_SETTINGS.scripts.roomPolicy,
  safeStartStop: DEFAULT_ACCOUNT_SETTINGS.scripts.safeStartStop,
};

export const snapshotRoomPolicy = (policy: RoomPolicy): RoomPolicy => ({
  ...policy,
});

const decodeRoomPolicy = Schema.decodeUnknownEffect(RoomPolicySchema);

export const snapshotScriptRuntimeOptions = (
  options: ScriptRuntimeOptions,
): ScriptRuntimeOptions => ({
  restartAfterReconnect: options.restartAfterReconnect,
  roomPolicy: snapshotRoomPolicy(options.roomPolicy),
  safeStartStop: options.safeStartStop,
});

export type ScriptRuntimeOptionsUpdate = (
  options: ScriptRuntimeOptions,
) => ScriptRuntimeOptions;

export interface ScriptRuntimeApiOptions {
  readonly getOptions: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly inputValues: ScriptInputValues;
  readonly log: (message: unknown) => void;
  readonly scope: ScriptAsyncScope;
  readonly setOptions: (
    update: ScriptRuntimeOptionsUpdate,
  ) => Effect.Effect<ScriptRuntimeOptions>;
}

export interface ScriptExitActions {
  readonly closeWindow: () => void;
  readonly logout: () => Effect.Effect<void>;
}

export const runScriptExitActions = Effect.fn(
  "ScriptRuntime.runScriptExitActions",
)(function* (
  request: ScriptExitRequest | undefined,
  actions: ScriptExitActions,
) {
  if (request?.logout === true) {
    yield* actions.logout();
  }
  if (request?.logout === true && request.closeWindow === true) {
    yield* Effect.sleep("1 second");
  }
  if (request?.closeWindow === true) {
    yield* Effect.sync(actions.closeWindow);
  }
});

export const makeScriptRuntimeApi = (
  options: ScriptRuntimeApiOptions,
): ScriptRuntimeApi => {
  const inputValues = { ...options.inputValues };
  const script: ScriptRuntimeApi = {
    beep: (times = 1) =>
      Number.isFinite(times)
        ? Effect.sync(() => playBeep(Math.max(1, Math.floor(times))))
        : Effect.fail(
            new ScriptExecutionError({
              detail: "script.beep requires a finite number of repetitions.",
            }),
          ),
    exit: (exitOptions) => Effect.fail(makeScriptExitSignal(exitOptions)),
    inputs: {
      get: (key: string) => Effect.succeed(inputValues[key]),
      getAll: () => Effect.succeed({ ...inputValues }),
    },
    log: (message) => Effect.sync(() => options.log(message)),
    options: {
      getAll: options.getOptions,
      getRestartAfterReconnect: () =>
        options
          .getOptions()
          .pipe(
            Effect.map(
              (currentOptions) => currentOptions.restartAfterReconnect,
            ),
          ),
      getRoomPolicy: () =>
        options
          .getOptions()
          .pipe(
            Effect.map((currentOptions) =>
              snapshotRoomPolicy(currentOptions.roomPolicy),
            ),
          ),
      getSafeStartStop: () =>
        options
          .getOptions()
          .pipe(Effect.map((currentOptions) => currentOptions.safeStartStop)),
      reset: () => options.setOptions(() => DEFAULT_SCRIPT_RUNTIME_OPTIONS),
      setRestartAfterReconnect: (enabled: boolean) =>
        options.setOptions((currentOptions) => ({
          ...currentOptions,
          restartAfterReconnect: enabled,
        })),
      setRoomPolicy: (policy: RoomPolicy) =>
        decodeRoomPolicy(policy).pipe(
          Effect.mapError(
            (cause) =>
              new ScriptExecutionError({
                cause,
                detail:
                  "script.options.setRoomPolicy requires a valid room policy.",
              }),
          ),
          Effect.flatMap((roomPolicy) =>
            options.setOptions((currentOptions) => ({
              ...currentOptions,
              roomPolicy: snapshotRoomPolicy(roomPolicy),
            })),
          ),
        ),
      setSafeStartStop: (enabled: boolean) =>
        options.setOptions((currentOptions) => ({
          ...currentOptions,
          safeStartStop: enabled,
        })),
    },
    signal: options.scope.signal,
    sleep: (ms) =>
      Number.isFinite(ms) && ms >= 0
        ? Effect.sleep(`${Math.trunc(ms)} millis`)
        : Effect.fail(
            new ScriptExecutionError({
              detail: "script.sleep requires a non-negative finite number.",
            }),
          ),
    stop: (reason) =>
      Effect.fail(new ScriptStopSignal(reason === undefined ? {} : { reason })),
  };
  return Object.freeze(script);
};
