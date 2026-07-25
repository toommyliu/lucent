import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";

import { reconcileFollowerCombatProfileId } from "./profileSelection";

const customProfile = {
  ...DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]!,
  id: "custom",
  label: "Custom",
};

const library: CombatProfileLibrary = {
  ...DEFAULT_COMBAT_PROFILE_LIBRARY,
  profiles: [...DEFAULT_COMBAT_PROFILE_LIBRARY.profiles, customProfile],
};

describe("follower combat profile selection", () => {
  it("keeps an available profile and falls back to Generic after deletion", () => {
    expect(reconcileFollowerCombatProfileId(library, customProfile.id)).toBe(
      customProfile.id,
    );
    expect(
      reconcileFollowerCombatProfileId(
        DEFAULT_COMBAT_PROFILE_LIBRARY,
        customProfile.id,
      ),
    ).toBe(DEFAULT_COMBAT_PROFILE_ID);
  });
});
