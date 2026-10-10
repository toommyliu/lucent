import * as Schema from "effect/Schema";

import { defineEvent } from "./core";

const namespace = "desktop:diagnostics";

export const RendererDiagnosticErrorSchema = Schema.Struct({
  message: Schema.String,
  name: Schema.String,
  stack: Schema.optionalKey(Schema.String),
});

export type RendererDiagnosticError = typeof RendererDiagnosticErrorSchema.Type;

export const RendererDiagnosticPayloadSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("renderer.error"),
    columnNumber: Schema.optionalKey(Schema.Number),
    error: RendererDiagnosticErrorSchema,
    lineNumber: Schema.optionalKey(Schema.Number),
    observedAt: Schema.String,
    source: Schema.optionalKey(Schema.String),
    view: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("renderer.unhandled-rejection"),
    error: RendererDiagnosticErrorSchema,
    observedAt: Schema.String,
    view: Schema.String,
  }),
]);

export type RendererDiagnosticPayload =
  typeof RendererDiagnosticPayloadSchema.Type;

export const DiagnosticsIpc = {
  rendererRecord: defineEvent({
    channel: `${namespace}:renderer-record`,
    name: "diagnostics.rendererRecord",
    payload: RendererDiagnosticPayloadSchema,
  }),
} as const;
