import { Schema } from "effect";

import { defineInvoke } from "./core";

const namespace = "desktop:windows";

export const DesktopWindowKindSchema = Schema.Literals([
  "account-manager",
  "combat-profiles",
  "environment",
  "game",
  "settings",
]);

export const WindowsIpc = {
  open: defineInvoke({
    channel: `${namespace}:open`,
    name: "windows.open",
    payload: Schema.Struct({
      kind: DesktopWindowKindSchema,
    }),
    result: Schema.String,
  }),
} as const;
