import { Schema } from "effect";

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
