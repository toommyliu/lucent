import { Schema } from "effect";

import {
  GrabbedDataSchema,
  LoaderGrabberGrabRequestSchema,
  LoaderGrabberLoadRequestSchema,
} from "../loader-grabber";
import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:loader-grabber";

const LoadRequest = Schema.Struct({
  kind: Schema.Literal("load"),
  payload: LoaderGrabberLoadRequestSchema,
  requestId: Schema.String,
});

const GrabRequest = Schema.Struct({
  kind: Schema.Literal("grab"),
  payload: LoaderGrabberGrabRequestSchema,
  requestId: Schema.String,
});

export const LoaderGrabberRequestSchema = Schema.Union([
  LoadRequest,
  GrabRequest,
]);
export type LoaderGrabberRequest = typeof LoaderGrabberRequestSchema.Type;

const LoadOutcome = Schema.Struct({
  kind: Schema.Literal("load"),
});
const GrabOutcome = Schema.Struct({
  kind: Schema.Literal("grab"),
  value: Schema.NullOr(GrabbedDataSchema),
});

export const LoaderGrabberOutcomeSchema = Schema.Union([
  LoadOutcome,
  GrabOutcome,
]);
export type LoaderGrabberOutcome = typeof LoaderGrabberOutcomeSchema.Type;

export const LoaderGrabberResponseSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    outcome: LoaderGrabberOutcomeSchema,
    requestId: Schema.String,
  }),
  Schema.Struct({
    error: Schema.String,
    ok: Schema.Literal(false),
    requestId: Schema.String,
  }),
]);
export type LoaderGrabberResponse = typeof LoaderGrabberResponseSchema.Type;

export const LoaderGrabberIpc = {
  load: defineInvoke({
    channel: `${namespace}:load`,
    name: "loaderGrabber.load",
    payload: LoaderGrabberLoadRequestSchema,
    result: Schema.Void,
  }),
  grab: defineInvoke({
    channel: `${namespace}:grab`,
    name: "loaderGrabber.grab",
    payload: LoaderGrabberGrabRequestSchema,
    result: Schema.NullOr(GrabbedDataSchema),
  }),
  request: defineEvent({
    channel: `${namespace}:request`,
    name: "loaderGrabber.request",
    payload: LoaderGrabberRequestSchema,
  }),
  respond: defineInvoke({
    channel: `${namespace}:respond`,
    name: "loaderGrabber.respond",
    payload: LoaderGrabberResponseSchema,
    result: Schema.Void,
  }),
} as const;
