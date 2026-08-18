import * as Schema from "effect/Schema";

import {
  ScriptFileReferenceSchema,
  ScriptInputValuesSchema,
} from "./scriptInputs";

/** One independently configurable occurrence of a script in a queue. */
export const ScriptQueueEntrySchema = Schema.Struct({
  id: Schema.String,
  file: ScriptFileReferenceSchema,
  revision: Schema.String,
  inputDefinitionId: Schema.NullOr(Schema.String),
  inputValues: ScriptInputValuesSchema,
});

export type ScriptQueueEntry = typeof ScriptQueueEntrySchema.Type;

/** An ordered queue snapshot suitable for future per-client dispatch. */
export const ScriptQueueDefinitionSchema = Schema.Struct({
  entries: Schema.Array(ScriptQueueEntrySchema),
});

export type ScriptQueueDefinition = typeof ScriptQueueDefinitionSchema.Type;
