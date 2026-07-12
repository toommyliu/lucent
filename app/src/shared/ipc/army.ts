import { Schema } from "effect";

import {
  ArmyConfigPayloadSchema,
  ArmySessionEndedPayloadSchema,
  ArmySessionPayloadSchema,
  type ArmyProgressResult,
} from "@lucent/core/army";
import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:army";

const SyncPayloadFields = {
  label: Schema.optionalKey(Schema.String),
  sessionId: Schema.String,
  step: Schema.Int,
  timeoutMs: Schema.optionalKey(Schema.Number),
} as const;

const SyncPayloadSchema = Schema.Struct(SyncPayloadFields);

const ProgressResultSchema = Schema.Struct({
  complete: Schema.Boolean,
  completedPlayers: Schema.Array(Schema.String),
  pendingPlayers: Schema.Array(Schema.String),
});

export const ArmyIpc = {
  loadConfig: defineInvoke({
    channel: `${namespace}:load-config`,
    name: "army.loadConfig",
    payload: Schema.Struct({
      configName: Schema.String,
    }),
    result: ArmyConfigPayloadSchema,
  }),
  start: defineInvoke({
    channel: `${namespace}:start`,
    name: "army.start",
    payload: Schema.Struct({
      configName: Schema.String,
      playerName: Schema.String,
    }),
    result: ArmySessionPayloadSchema,
  }),
  leave: defineInvoke({
    channel: `${namespace}:leave`,
    name: "army.leave",
    payload: Schema.Struct({
      sessionId: Schema.String,
    }),
    result: Schema.Void,
  }),
  sync: defineInvoke({
    channel: `${namespace}:sync`,
    name: "army.sync",
    payload: SyncPayloadSchema,
    result: Schema.Void,
  }),
  progress: defineInvoke({
    channel: `${namespace}:progress`,
    name: "army.progress",
    payload: Schema.Struct({
      ...SyncPayloadFields,
      complete: Schema.Boolean,
    }),
    result: ProgressResultSchema,
  }),
  fail: defineInvoke({
    channel: `${namespace}:fail`,
    name: "army.fail",
    payload: Schema.Struct({
      label: Schema.optionalKey(Schema.String),
      reason: Schema.String,
      sessionId: Schema.String,
      step: Schema.optionalKey(Schema.Int),
    }),
    result: Schema.Void,
  }),
  ended: defineEvent({
    channel: `${namespace}:ended`,
    name: "army.ended",
    payload: ArmySessionEndedPayloadSchema,
  }),
} as const;

export type ArmyProgressResultPayload = ArmyProgressResult;
