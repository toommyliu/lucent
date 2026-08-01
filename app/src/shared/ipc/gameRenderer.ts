import * as Schema from "effect/Schema";

import { defineInvoke } from "./core";

const namespace = "desktop:game-renderer";

export const GameRendererIpc = {
  getGeneration: defineInvoke({
    channel: `${namespace}:get-generation`,
    name: "gameRenderer.getGeneration",
    payload: Schema.Void,
    result: Schema.Int,
  }),
  ready: defineInvoke({
    channel: `${namespace}:ready`,
    name: "gameRenderer.ready",
    payload: Schema.Struct({ generation: Schema.Int }),
    result: Schema.Void,
  }),
} as const;
