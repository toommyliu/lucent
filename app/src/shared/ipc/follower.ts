import {
  FollowerConfigSchema,
  FollowerStartPayloadSchema,
  FollowerStateSchema,
} from "@lucent/core/follower";
import * as Schema from "effect/Schema";

import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:follower";

export const FollowerPlayersSchema = Schema.Array(Schema.String);
export type FollowerPlayers = typeof FollowerPlayersSchema.Type;

export const FollowerIpc = {
  getConfig: defineInvoke({
    channel: `${namespace}:get-config`,
    name: "follower.getConfig",
    payload: Schema.Void,
    result: Schema.NullOr(FollowerConfigSchema),
  }),
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
