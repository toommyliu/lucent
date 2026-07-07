import { Schema } from "effect";

import {
  CombatProfileLibrarySchema,
  CombatProfileSchema,
} from "../combat-profiles";
import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:combat-profiles";

export const CombatProfilesIpc = {
  getState: defineInvoke({
    channel: `${namespace}:get-state`,
    name: "combatProfiles.getState",
    payload: Schema.Void,
    result: CombatProfileLibrarySchema,
  }),
  saveProfile: defineInvoke({
    channel: `${namespace}:save-profile`,
    name: "combatProfiles.saveProfile",
    payload: CombatProfileSchema,
    result: CombatProfileLibrarySchema,
  }),
  deleteProfile: defineInvoke({
    channel: `${namespace}:delete-profile`,
    name: "combatProfiles.deleteProfile",
    payload: Schema.Struct({
      profileId: Schema.String,
    }),
    result: CombatProfileLibrarySchema,
  }),
  changed: defineEvent({
    channel: `${namespace}:changed`,
    name: "combatProfiles.changed",
    payload: CombatProfileLibrarySchema,
  }),
} as const;
