import { Effect } from "effect";

import type { ScriptInputValues } from "@lucent/core/scriptInputs";
import type { ScriptRuntimeApi, ScriptRuntimeOptions } from "./ScriptApi";
import { playBeep } from "./beep";
import type { ScriptAsyncScope } from "./scriptAsyncScope";
import {
  makeScriptExitSignal,
  ScriptExecutionError,
  ScriptStopSignal,
  type ScriptExitRequest,
} from "./ScriptRunnerErrors";

export const DEFAULT_SCRIPT_RUNTIME_OPTIONS: ScriptRuntimeOptions = {
  safeStartStop: true,
  usePrivateRooms: true,
};

export const snapshotScriptRuntimeOptions = (
  options: ScriptRuntimeOptions,
): ScriptRuntimeOptions => ({ ...options });

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
      getSafeStartStop: () =>
        options
          .getOptions()
          .pipe(Effect.map((currentOptions) => currentOptions.safeStartStop)),
      getUsePrivateRooms: () =>
        options
          .getOptions()
          .pipe(Effect.map((currentOptions) => currentOptions.usePrivateRooms)),
      reset: () => options.setOptions(() => DEFAULT_SCRIPT_RUNTIME_OPTIONS),
      setSafeStartStop: (enabled: boolean) =>
        options.setOptions((currentOptions) => ({
          ...currentOptions,
          safeStartStop: enabled,
        })),
      setUsePrivateRooms: (enabled: boolean) =>
        options.setOptions((currentOptions) => ({
          ...currentOptions,
          usePrivateRooms: enabled,
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
