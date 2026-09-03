import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";

import {
  DEFAULT_ACCOUNT_SETTINGS,
  RoomPolicySchema,
} from "@lucent/core/accountSettings";
import type {
  ScriptInputValue,
  ScriptInputValues,
} from "@lucent/core/scriptInputs";
import type {
  RoomPolicy,
  ScriptRuntimeApi,
  ScriptRuntimeOptions,
} from "./ScriptApi";
import { playBeep } from "../audio/beep";
import type { ScriptAsyncScope } from "./scriptAsyncScope";
import type { ScriptDialogSource, ScriptDialogsShape } from "./ScriptDialogs";
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

const snapshotScriptInputValue = (value: ScriptInputValue): ScriptInputValue =>
  Array.isArray(value) ? [...value] : value;

const snapshotScriptInputValues = (
  values: ScriptInputValues,
): ScriptInputValues => {
  const snapshot: Record<string, ScriptInputValue> = {};
  for (const [key, value] of Object.entries(values)) {
    snapshot[key] = snapshotScriptInputValue(value);
  }
  return snapshot;
};

export type ScriptRuntimeOptionsUpdate = (
  options: ScriptRuntimeOptions,
) => ScriptRuntimeOptions;

export interface ScriptRuntimeApiOptions {
  readonly dialogs: Pick<ScriptDialogsShape, "alert" | "confirm" | "prompt">;
  readonly getOptions: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly inputValues: ScriptInputValues;
  readonly log: (message: unknown) => void;
  readonly scope: ScriptAsyncScope;
  readonly setOptions: (
    update: ScriptRuntimeOptionsUpdate,
  ) => Effect.Effect<ScriptRuntimeOptions>;
  readonly source: ScriptDialogSource;
}

export interface ScriptExitActions {
  readonly closeClient: () => void;
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
  if (request?.logout === true && request.closeClient === true) {
    yield* Effect.sleep("1 second");
  }
  if (request?.closeClient === true) {
    yield* Effect.sync(actions.closeClient);
  }
});

export const makeScriptRuntimeApi = (
  options: ScriptRuntimeApiOptions,
): ScriptRuntimeApi => {
  const inputValues = snapshotScriptInputValues(options.inputValues);
  const source = { ...options.source };
  const script: ScriptRuntimeApi = {
    alert: (message) => options.dialogs.alert(source, message),
    beep: (times = 1) =>
      Number.isFinite(times)
        ? Effect.sync(() => playBeep(Math.max(1, Math.floor(times))))
        : Effect.fail(
            new ScriptExecutionError({
              detail: "script.beep requires a finite number of repetitions.",
            }),
          ),
    confirm: (message) => options.dialogs.confirm(source, message),
    exit: (exitOptions) => Effect.fail(makeScriptExitSignal(exitOptions)),
    inputs: Object.freeze({
      get: (key: string) => {
        const value = inputValues[key];
        return Effect.succeed(
          value === undefined ? undefined : snapshotScriptInputValue(value),
        );
      },
      getAll: () => Effect.succeed(snapshotScriptInputValues(inputValues)),
    }),
    log: (message) => Effect.sync(() => options.log(message)),
    options: Object.freeze({
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
    }),
    prompt: (message, defaultValue) =>
      options.dialogs.prompt(source, message, defaultValue),
    signal: options.scope.signal,
    sleep: (duration) =>
      Effect.try({
        try: () => Duration.toMillis(duration),
        catch: (cause) =>
          new ScriptExecutionError({
            cause,
            detail: "Invalid duration.",
          }),
      }).pipe(
        Effect.flatMap((milliseconds) =>
          Number.isFinite(milliseconds) && milliseconds >= 0
            ? Effect.sleep(duration)
            : Effect.fail(
                new ScriptExecutionError({
                  detail: "Duration must be non-negative and finite.",
                }),
              ),
        ),
      ),
    stop: (reason) =>
      Effect.fail(new ScriptStopSignal(reason === undefined ? {} : { reason })),
  };
  return Object.freeze(script);
};
