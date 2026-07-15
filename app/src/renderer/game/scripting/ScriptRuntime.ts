import { Effect } from "effect";

import type { ScriptInputValues } from "@lucent/core/scriptInputs";
import type { ApiService } from "../flash/api/Api";
import type { ScriptRuntimeApi, ScriptRuntimeOptions } from "./ScriptApi";
import type { ScriptAsyncScope } from "./scriptAsyncScope";
import { ScriptExecutionError, ScriptStopSignal } from "./ScriptRunnerErrors";

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
  readonly auth: ApiService["auth"];
  readonly getOptions: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly inputValues: ScriptInputValues;
  readonly log: (message: unknown) => void;
  readonly scope: ScriptAsyncScope;
  readonly setOptions: (
    update: ScriptRuntimeOptionsUpdate,
  ) => Effect.Effect<ScriptRuntimeOptions>;
}

export const makeScriptRuntimeApi = (
  options: ScriptRuntimeApiOptions,
): ScriptRuntimeApi => {
  const inputValues = { ...options.inputValues };
  const script: ScriptRuntimeApi = {
    exit: (exitOptions) =>
      Effect.gen(function* () {
        if (exitOptions?.logout === true) {
          yield* options.auth.logout();
        }

        if (exitOptions?.closeWindow === true) {
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
