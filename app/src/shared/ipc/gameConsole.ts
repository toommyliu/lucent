import * as Schema from "effect/Schema";

import { defineEvent } from "./core";

const namespace = "desktop:game-console";

export const GameConsoleRendererMessagePayloadSchema = Schema.Struct({
  message: Schema.String,
});

export const GameConsoleIpc = {
  rendererMessage: defineEvent({
    channel: `${namespace}:renderer-message`,
    name: "gameConsole.rendererMessage",
    payload: GameConsoleRendererMessagePayloadSchema,
  }),
} as const;
