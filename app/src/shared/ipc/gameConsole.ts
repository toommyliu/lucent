import { Schema } from "effect";

import { defineEvent } from "./core";

const namespace = "desktop:game-console";

export const GameConsoleRendererMessagePayloadSchema = Schema.Struct({
  message: Schema.String,
});

export type GameConsoleRendererMessagePayload =
  typeof GameConsoleRendererMessagePayloadSchema.Type;

export const GameConsoleIpc = {
  rendererMessage: defineEvent({
    channel: `${namespace}:renderer-message`,
    name: "gameConsole.rendererMessage",
    payload: GameConsoleRendererMessagePayloadSchema,
  }),
} as const;
