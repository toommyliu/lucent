import { LiveAura } from "@lucent/game";
import type { AuraKind } from "@lucent/game";
import { Schema } from "effect";

import { WireBoolean, WireNumber } from "../Coercion";

export const AuraPayload = Schema.Struct({
  cat: Schema.optionalKey(Schema.String),
  dur: Schema.optionalKey(WireNumber),
  icon: Schema.optionalKey(Schema.String),
  isNew: Schema.optionalKey(WireBoolean),
  msgOff: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  ),
  msgOn: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  ),
  nam: Schema.String,
  val: Schema.optionalKey(WireNumber),
});
export type AuraPayload = typeof AuraPayload.Type;

export const AuraPayloads = Schema.Array(AuraPayload);

export const toAura = (
  payload: AuraPayload,
  kind: AuraKind,
  stack = 1,
): LiveAura =>
  new LiveAura({
    ...(payload.cat === undefined ? {} : { category: payload.cat }),
    duration: payload.dur ?? 0,
    ...(payload.icon === undefined ? {} : { icon: payload.icon }),
    kind,
    name: payload.nam,
    stack,
    ...(payload.val === undefined ? {} : { value: payload.val }),
  });
