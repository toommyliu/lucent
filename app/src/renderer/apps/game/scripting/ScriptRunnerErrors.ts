import * as Schema from "effect/Schema";

export class ScriptExecutionError extends Schema.TaggedErrorClass<ScriptExecutionError>()(
  "ScriptExecutionError",
  {
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ScriptNotReadyError extends Schema.TaggedErrorClass<ScriptNotReadyError>()(
  "ScriptNotReadyError",
  {
    detail: Schema.String,
    missing: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ScriptStopSignal extends Schema.TaggedErrorClass<ScriptStopSignal>()(
  "ScriptStopSignal",
  {
    reason: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.reason ?? "Script stopped.";
  }
}

export interface ScriptExitRequest {
  readonly closeWindow: boolean;
  readonly logout: boolean;
}

const scriptExitRequests = new WeakMap<ScriptStopSignal, ScriptExitRequest>();

export const makeScriptExitSignal = (options?: {
  readonly closeWindow?: boolean;
  readonly logout?: boolean;
}): ScriptStopSignal => {
  const signal = new ScriptStopSignal({ reason: "Requested by the script" });
  const request: ScriptExitRequest = {
    closeWindow: options?.closeWindow === true,
    logout: options?.logout === true,
  };
  // Keep an explicit marker even when no actions were requested. The runner
  // must distinguish script.exit() from script.stop().
  scriptExitRequests.set(signal, request);
  return signal;
};

export const getScriptExitRequest = (
  signal: ScriptStopSignal,
): ScriptExitRequest | undefined => scriptExitRequests.get(signal);
