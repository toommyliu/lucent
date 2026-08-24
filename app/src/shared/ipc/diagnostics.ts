import * as Schema from "effect/Schema";

import { defineEvent } from "./core";

const namespace = "desktop:diagnostics";

export const RendererDiagnosticErrorSchema = Schema.Struct({
  message: Schema.String,
  name: Schema.String,
  stack: Schema.optionalKey(Schema.String),
});

export type RendererDiagnosticError = typeof RendererDiagnosticErrorSchema.Type;

export const DesktopTraceContextSchema = Schema.Struct({
  sampled: Schema.Boolean,
  spanId: Schema.String,
  traceId: Schema.String,
});

export type DesktopTraceContext = typeof DesktopTraceContextSchema.Type;

export const DesktopIpcTraceEnvelopeSchema = Schema.Struct({
  payload: Schema.Unknown,
  trace: DesktopTraceContextSchema,
});

export type DesktopIpcTraceEnvelope = typeof DesktopIpcTraceEnvelopeSchema.Type;

const DesktopTraceAttributesSchema = Schema.Record(
  Schema.String,
  Schema.Unknown,
);

export const DesktopTraceSpanSchema = Schema.Struct({
  attributes: DesktopTraceAttributesSchema,
  durationMs: Schema.Number,
  endTimeUnixNano: Schema.String,
  events: Schema.Array(
    Schema.Struct({
      attributes: DesktopTraceAttributesSchema,
      name: Schema.String,
      timeUnixNano: Schema.String,
    }),
  ),
  exit: Schema.Union([
    Schema.TaggedStruct("Success", {}),
    Schema.TaggedStruct("Failure", {
      cause: Schema.String,
    }),
    Schema.TaggedStruct("Interrupted", {
      cause: Schema.String,
    }),
  ]),
  kind: Schema.Literals([
    "internal",
    "server",
    "client",
    "producer",
    "consumer",
  ]),
  links: Schema.Array(
    Schema.Struct({
      attributes: DesktopTraceAttributesSchema,
      spanId: Schema.String,
      traceId: Schema.String,
    }),
  ),
  name: Schema.String,
  parentSpanId: Schema.optionalKey(Schema.String),
  sampled: Schema.Boolean,
  source: Schema.Literals(["effect", "renderer"]),
  spanId: Schema.String,
  startTimeUnixNano: Schema.String,
  traceId: Schema.String,
});

export type DesktopTraceSpan = typeof DesktopTraceSpanSchema.Type;

export interface DesktopTraceResponse {
  readonly recordingStartedAt: string | null;
  readonly spans: readonly DesktopTraceSpan[];
  readonly truncated: boolean;
}

export interface GameConsoleMessage {
  readonly at: string;
  readonly gameWindowId: number;
  readonly generation: number;
  readonly id: number;
  readonly message: string;
  readonly username: string | null;
}

export interface GameConsoleWindowState {
  readonly closedAt: string | null;
  readonly gameWindowId: number;
  readonly generation: number;
  readonly lastMessageAt: string | null;
  readonly lastMessageId: number | null;
  readonly messageCount: number;
  readonly openedAt: string;
  readonly state: "active" | "closed";
  readonly username: string | null;
}

export interface GameConsoleState {
  readonly activeGameWindowCount: number;
  readonly buffer: {
    readonly bytes: number;
    readonly dropped: number;
    readonly maxBytes: number;
    readonly maxMessageBytes: number;
    readonly maxRows: number;
    readonly size: number;
  };
  readonly windows: readonly GameConsoleWindowState[];
}

export const RendererDiagnosticPayloadSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("trace.span"),
    span: DesktopTraceSpanSchema,
    view: Schema.String,
  }),
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
