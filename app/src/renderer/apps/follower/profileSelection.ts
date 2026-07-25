import {
  getCombatProfileById,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";

export function reconcileFollowerCombatProfileId(
  library: CombatProfileLibrary,
  selectedProfileId: string,
): string {
  return getCombatProfileById(library, selectedProfileId).id;
}
