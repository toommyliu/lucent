import {
  FollowerConfigSchema,
  FollowerStartPayloadSchema,
  FollowerStateSchema,
} from "@lucent/core/follower";
import * as Schema from "effect/Schema";

import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:follower";

export const FollowerCommandSchema = Schema.Union([
  Schema.Struct({
    config: FollowerConfigSchema,
    kind: Schema.Literal("configure"),
    requestId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("get-state"),
    requestId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("me"),
    requestId: Schema.String,
  }),
  Schema.Struct({
    config: FollowerConfigSchema,
    kind: Schema.Literal("start"),
    requestId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("stop"),
    requestId: Schema.String,
  }),
]);
export type FollowerCommand = typeof FollowerCommandSchema.Type;

export const FollowerCommandOutcomeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("configure"),
    state: FollowerStateSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("get-state"),
    state: FollowerStateSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("me"),
    username: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("start"),
    state: FollowerStateSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("stop"),
    state: FollowerStateSchema,
  }),
]);
export type FollowerCommandOutcome = typeof FollowerCommandOutcomeSchema.Type;

export const FollowerCommandResponseSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    outcome: FollowerCommandOutcomeSchema,
    requestId: Schema.String,
  }),
  Schema.Struct({
    error: Schema.String,
    ok: Schema.Literal(false),
    requestId: Schema.String,
  }),
]);
export type FollowerCommandResponse = typeof FollowerCommandResponseSchema.Type;

export const FollowerPlayersSchema = Schema.Array(Schema.String);
export type FollowerPlayers = typeof FollowerPlayersSchema.Type;

export const FollowerIpc = {
  configure: defineInvoke({
    channel: `${namespace}:configure`,
    name: "follower.configure",
    payload: FollowerStartPayloadSchema,
    result: FollowerStateSchema,
  }),
  getState: defineInvoke({
    channel: `${namespace}:get-state`,
    name: "follower.getState",
    payload: Schema.Void,
    result: FollowerStateSchema,
  }),
  getPlayers: defineInvoke({
    channel: `${namespace}:get-players`,
    name: "follower.getPlayers",
    payload: Schema.Void,
    result: FollowerPlayersSchema,
  }),
  me: defineInvoke({
    channel: `${namespace}:me`,
    name: "follower.me",
    payload: Schema.Void,
    result: Schema.String,
  }),
  start: defineInvoke({
    channel: `${namespace}:start`,
    name: "follower.start",
    payload: FollowerStartPayloadSchema,
    result: FollowerStateSchema,
  }),
  stop: defineInvoke({
    channel: `${namespace}:stop`,
    name: "follower.stop",
    payload: Schema.Void,
    result: FollowerStateSchema,
  }),
  changed: defineEvent({
    channel: `${namespace}:changed`,
    name: "follower.changed",
    payload: FollowerStateSchema,
  }),
  playersChanged: defineEvent({
    channel: `${namespace}:players-changed`,
    name: "follower.playersChanged",
    payload: FollowerPlayersSchema,
  }),
  command: defineEvent({
    channel: `${namespace}:command`,
    name: "follower.command",
    payload: FollowerCommandSchema,
  }),
  respond: defineInvoke({
    channel: `${namespace}:respond`,
    name: "follower.respond",
    payload: FollowerCommandResponseSchema,
    result: Schema.Void,
  }),
  publishState: defineInvoke({
    channel: `${namespace}:publish-state`,
    name: "follower.publishState",
    payload: FollowerStateSchema,
    result: Schema.Void,
  }),
  publishPlayers: defineInvoke({
    channel: `${namespace}:publish-players`,
    name: "follower.publishPlayers",
    payload: FollowerPlayersSchema,
    result: Schema.Void,
  }),
} as const;
