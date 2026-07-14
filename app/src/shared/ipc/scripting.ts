import { Schema } from "effect";

import {
  ScriptFileResolutionSchema,
  ScriptFileSchema,
  ScriptInputsDefinitionSchema,
  ScriptInputValuesSchema,
  ScriptOpenFileResultSchema,
  ScriptSelectFileResultSchema,
} from "@lucent/core/scriptInputs";
import { defineInvoke } from "./core";

export type {
  ScriptFile,
  ScriptFileResolution,
  ScriptOpenFileResult,
  ScriptSelectFileResult,
} from "@lucent/core/scriptInputs";

const namespace = "desktop:scripting";

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
  resolveFile: defineInvoke({
    channel: `${namespace}:resolve-file`,
    name: "scripting.resolveFile",
    payload: Schema.Struct({
      path: Schema.String,
    }),
    result: ScriptFileResolutionSchema,
  }),
  selectFile: defineInvoke({
    channel: `${namespace}:select-file`,
    name: "scripting.selectFile",
    payload: Schema.Void,
    result: ScriptSelectFileResultSchema,
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
