import {
  DEFAULT_COMBAT_PROFILE_ID,
  type CombatProfile,
} from "@lucent/core/combatProfiles";

import { readLocalStorageValue, writeLocalStorageValue } from "../localStorage";

const SELECTED_COMBAT_PROFILE_STORAGE_KEY =
  "lucent.combatProfiles.selectedProfileId";

export function readStoredCombatProfileId(): string | undefined {
  return readLocalStorageValue(SELECTED_COMBAT_PROFILE_STORAGE_KEY);
}

export function writeStoredCombatProfileId(profileId: string): void {
  writeLocalStorageValue(SELECTED_COMBAT_PROFILE_STORAGE_KEY, profileId);
}

export function resolvePreferredCombatProfileId(
  profiles: readonly CombatProfile[],
  preferredId: string | undefined,
  defaultId = DEFAULT_COMBAT_PROFILE_ID,
): string {
  return (
    profiles.find((profile) => profile.id === preferredId)?.id ??
    profiles.find((profile) => profile.id !== defaultId)?.id ??
    profiles[0]?.id ??
    defaultId
  );
}
