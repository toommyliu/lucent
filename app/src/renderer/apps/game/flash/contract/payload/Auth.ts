import { LiveServer } from "@lucent/game";
import { Schema } from "effect";

import { WireBoolean, WireInt } from "../Coercion";

export const ServerPayload = Schema.Struct({
  iChat: Schema.optionalKey(WireInt),
  iCount: Schema.optionalKey(WireInt),
  iMax: Schema.optionalKey(WireInt),
  bOnline: Schema.optionalKey(WireBoolean),
  bUpg: Schema.optionalKey(WireBoolean),
  sLang: Schema.optionalKey(Schema.String),
  sName: Schema.String,
});
export type ServerPayload = typeof ServerPayload.Type;

export const ServerPayloads = Schema.Array(ServerPayload);

export const toServer = (payload: ServerPayload): LiveServer =>
  new LiveServer({
    chat: payload.iChat ?? 0,
    count: payload.iCount ?? 0,
    language: payload.sLang ?? "",
    max: payload.iMax ?? 0,
    memberOnly: payload.bUpg ?? false,
    name: payload.sName,
    online: payload.bOnline ?? true,
  });
