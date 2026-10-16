import * as Schema from "effect/Schema";

import {
  PacketCapturedPayloadSchema,
  PacketQueuePayloadSchema,
  PacketSendPayloadSchema,
  PacketsStatusPayloadSchema,
} from "../packets";
import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:packets";

export const PacketsIpc = {
  getStatus: defineInvoke({
    channel: `${namespace}:get-status`,
    name: "packets.getStatus",
    payload: Schema.Void,
    result: PacketsStatusPayloadSchema,
  }),
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
} as const;
