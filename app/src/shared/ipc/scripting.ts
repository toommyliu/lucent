import { Schema } from "effect";

import {
  ScriptInputsDefinitionSchema,
  ScriptInputValuesSchema,
} from "@lucent/core/scriptInputs";
import { defineInvoke } from "./core";

const namespace = "desktop:scripting";

export const ScriptFileSchema = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  source: Schema.String,
  inputs: Schema.NullOr(ScriptInputsDefinitionSchema),
});

export type ScriptFile = typeof ScriptFileSchema.Type;

export const ScriptOpenFileResultSchema = Schema.Union([
  Schema.Struct({
    canceled: Schema.Literal(true),
  }),
  Schema.Struct({
    canceled: Schema.Literal(false),
    file: ScriptFileSchema,
  }),
]);

export type ScriptOpenFileResult = typeof ScriptOpenFileResultSchema.Type;

export const ScriptingIpc = {
  openFile: defineInvoke({
    channel: `${namespace}:open-file`,
    name: "scripting.openFile",
    payload: Schema.Void,
    result: ScriptOpenFileResultSchema,
  }),
  readFile: defineInvoke({
    channel: `${namespace}:read-file`,
    name: "scripting.readFile",
    payload: Schema.Struct({
      path: Schema.String,
    }),
    result: ScriptFileSchema,
  }),
  openPath: defineInvoke({
    channel: `${namespace}:open-path`,
    name: "scripting.openPath",
    payload: Schema.Struct({
      path: Schema.String,
    }),
    result: Schema.Boolean,
  }),
  getInputValues: defineInvoke({
    channel: `${namespace}:get-input-values`,
    name: "scripting.getInputValues",
    payload: ScriptInputsDefinitionSchema,
    result: ScriptInputValuesSchema,
  }),
  saveInputValues: defineInvoke({
    channel: `${namespace}:save-input-values`,
    name: "scripting.saveInputValues",
    payload: Schema.Struct({
      definition: ScriptInputsDefinitionSchema,
      values: ScriptInputValuesSchema,
    }),
    result: ScriptInputValuesSchema,
  }),
} as const;
