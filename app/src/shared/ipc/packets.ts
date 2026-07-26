import { Schema } from "effect";

import {
  PacketCapturedPayloadSchema,
  PacketQueuePayloadSchema,
  PacketSendPayloadSchema,
  PacketsStatusPayloadSchema,
} from "../packets";
import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:packets";

export const PacketsRequestSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("start-capture"),
    requestId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("stop-capture"),
    requestId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("send"),
    payload: PacketSendPayloadSchema,
    requestId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("start-queue"),
    payload: PacketQueuePayloadSchema,
    requestId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("stop-queue"),
    requestId: Schema.String,
  }),
]);
export type PacketsRequest = typeof PacketsRequestSchema.Type;

export const PacketsOutcomeSchema = Schema.Struct({
  kind: Schema.Literals([
    "start-capture",
    "stop-capture",
    "send",
    "start-queue",
    "stop-queue",
  ]),
});
export type PacketsOutcome = typeof PacketsOutcomeSchema.Type;

export const PacketsResponseSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    outcome: PacketsOutcomeSchema,
    requestId: Schema.String,
  }),
  Schema.Struct({
    error: Schema.String,
    ok: Schema.Literal(false),
    requestId: Schema.String,
  }),
]);
export type PacketsResponse = typeof PacketsResponseSchema.Type;

export const PacketsIpc = {
  startCapture: defineInvoke({
    channel: `${namespace}:start-capture`,
    name: "packets.startCapture",
    payload: Schema.Void,
    result: Schema.Void,
  }),
  stopCapture: defineInvoke({
    channel: `${namespace}:stop-capture`,
    name: "packets.stopCapture",
    payload: Schema.Void,
    result: Schema.Void,
  }),
  send: defineInvoke({
    channel: `${namespace}:send`,
    name: "packets.send",
    payload: PacketSendPayloadSchema,
    result: Schema.Void,
  }),
  startQueue: defineInvoke({
    channel: `${namespace}:start-queue`,
    name: "packets.startQueue",
    payload: PacketQueuePayloadSchema,
    result: Schema.Void,
  }),
  stopQueue: defineInvoke({
    channel: `${namespace}:stop-queue`,
    name: "packets.stopQueue",
    payload: Schema.Void,
    result: Schema.Void,
  }),
  captured: defineEvent({
    channel: `${namespace}:captured`,
    name: "packets.captured",
    payload: PacketCapturedPayloadSchema,
  }),
  status: defineEvent({
    channel: `${namespace}:status`,
    name: "packets.status",
    payload: PacketsStatusPayloadSchema,
  }),
  publishCaptured: defineInvoke({
    channel: `${namespace}:publish-captured`,
    name: "packets.publishCaptured",
    payload: PacketCapturedPayloadSchema,
    result: Schema.Void,
  }),
  publishStatus: defineInvoke({
    channel: `${namespace}:publish-status`,
    name: "packets.publishStatus",
    payload: PacketsStatusPayloadSchema,
    result: Schema.Void,
  }),
  request: defineEvent({
    channel: `${namespace}:request`,
    name: "packets.request",
    payload: PacketsRequestSchema,
  }),
  respond: defineInvoke({
    channel: `${namespace}:respond`,
    name: "packets.respond",
    payload: PacketsResponseSchema,
    result: Schema.Void,
  }),
} as const;
