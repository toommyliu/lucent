import * as Schema from "effect/Schema";

import { HttpRequestPayloadSchema, HttpResultSchema } from "../http";
import { defineInvoke } from "./core";

export const HttpIpc = {
  openSession: defineInvoke({
    channel: "lucent:http:open-session",
    name: "http.openSession",
    payload: Schema.Void,
    result: Schema.String,
    trace: "metadata",
  }),
  closeSession: defineInvoke({
    channel: "lucent:http:close-session",
    name: "http.closeSession",
    payload: Schema.Struct({ sessionId: Schema.String }),
    result: Schema.Void,
    trace: "metadata",
  }),
  request: defineInvoke({
    channel: "lucent:http:request",
    name: "http.request",
    payload: HttpRequestPayloadSchema,
    result: HttpResultSchema,
    trace: "metadata",
  }),
  cancel: defineInvoke({
    channel: "lucent:http:cancel",
    name: "http.cancel",
    payload: Schema.Struct({ sessionId: Schema.String, requestId: Schema.Int }),
    result: Schema.Void,
    trace: "metadata",
  }),
} as const;
