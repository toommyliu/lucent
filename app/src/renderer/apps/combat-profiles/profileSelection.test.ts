import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  type CombatProfile,
} from "@lucent/core/combatProfiles";
import { afterEach, vi } from "vitest";

import {
  readStoredCombatProfileId,
  resolvePreferredCombatProfileId,
  writeStoredCombatProfileId,
} from "./profileSelection";

const storageKey = "lucent.combatProfiles.selectedProfileId";

const combatProfile = (id: string): CombatProfile => ({
  id,
  label: id,
  delayMs: 150,
  cooldownMode: "use-if-ready",
  steps: [],
});

afterEach(() => vi.unstubAllGlobals());

describe("combat profile selection", () => {
  it("uses the preferred profile when it exists", () => {
    const profiles = [
      combatProfile(DEFAULT_COMBAT_PROFILE_ID),
      combatProfile("preferred"),
    ];

    expect(resolvePreferredCombatProfileId(profiles, "preferred")).toBe(
      "preferred",
    );
  });

  it("falls back to a non-default profile, then the first profile", () => {
    expect(
      resolvePreferredCombatProfileId(
        [combatProfile(DEFAULT_COMBAT_PROFILE_ID), combatProfile("custom")],
        "missing",
      ),
    ).toBe("custom");
    expect(
      resolvePreferredCombatProfileId(
        [combatProfile(DEFAULT_COMBAT_PROFILE_ID)],
        "missing",
      ),
    ).toBe(DEFAULT_COMBAT_PROFILE_ID);
  });

  it("uses the default id when there are no profiles", () => {
    expect(resolvePreferredCombatProfileId([], undefined)).toBe(
      DEFAULT_COMBAT_PROFILE_ID,
    );
    expect(resolvePreferredCombatProfileId([], undefined, "fallback")).toBe(
      "fallback",
    );
  });

  it("persists the selected profile using the feature storage key", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    writeStoredCombatProfileId("custom");

    expect(values.get(storageKey)).toBe("custom");
    expect(readStoredCombatProfileId()).toBe("custom");
  });
});
