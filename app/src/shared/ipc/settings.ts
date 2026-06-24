import { Schema } from "effect";

import {
  AppearancePatchSchema,
  AppSettingsSchema,
  HotkeysPatchSchema,
  PreferencesPatchSchema,
} from "../settings";
import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:settings";

export const SettingsIpc = {
  get: defineInvoke({
    channel: `${namespace}:get`,
    name: "settings.get",
    payload: Schema.Void,
    result: AppSettingsSchema,
  }),
  updatePreferences: defineInvoke({
    channel: `${namespace}:update-preferences`,
    name: "settings.updatePreferences",
    payload: PreferencesPatchSchema,
    result: AppSettingsSchema,
  }),
  updateAppearance: defineInvoke({
    channel: `${namespace}:update-appearance`,
    name: "settings.updateAppearance",
    payload: AppearancePatchSchema,
    result: AppSettingsSchema,
  }),
  resetAppearance: defineInvoke({
    channel: `${namespace}:reset-appearance`,
    name: "settings.resetAppearance",
    payload: Schema.Void,
    result: AppSettingsSchema,
  }),
  updateHotkeys: defineInvoke({
    channel: `${namespace}:update-hotkeys`,
    name: "settings.updateHotkeys",
    payload: HotkeysPatchSchema,
    result: AppSettingsSchema,
  }),
  resetHotkeys: defineInvoke({
    channel: `${namespace}:reset-hotkeys`,
    name: "settings.resetHotkeys",
    payload: Schema.Void,
    result: AppSettingsSchema,
  }),
  changed: defineEvent({
    channel: `${namespace}:changed`,
    name: "settings.changed",
    payload: AppSettingsSchema,
  }),
} as const;
