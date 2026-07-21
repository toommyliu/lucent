import { Schema } from "effect";

export const Callback = Schema.Union([
  Schema.Struct({ type: Schema.Literal("connection"), status: Schema.String }),
  Schema.Struct({ type: Schema.Literal("debug"), message: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("extension-packet"),
    raw: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("client-packet"), raw: Schema.String }),
  Schema.Struct({ type: Schema.Literal("server-packet"), raw: Schema.String }),
]);

export type Callback = typeof Callback.Type;

export const decodeCallback = Schema.decodeUnknownOption(Callback);
