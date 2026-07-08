import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  COMBAT_PROFILE_LIBRARY_VERSION,
  CombatProfileLibrarySchema,
  CombatProfileNormalizationError,
  DEFAULT_COMBAT_PROFILE_ID,
  type CombatProfileLibrary,
  getCombatProfileById,
  isCombatProfileDefinition,
  normalizeCombatProfile,
  normalizeCombatProfileLibrary,
  serializeCombatProfileLibrary,
} from "./combatProfiles";

const genericProfile = {
  id: DEFAULT_COMBAT_PROFILE_ID,
  label: "Generic",
  role: "Base",
  delayMs: 150,
  cooldownMode: "use-if-ready",
  steps: [1, 2, 3, 4].map((skill) => ({
    id: `generic-${skill}`,
    skill,
    conditions: [],
  })),
} satisfies CombatProfileLibrary["profiles"][number];

const canonicalLibrary = {
  version: COMBAT_PROFILE_LIBRARY_VERSION,
  profiles: [
    genericProfile,
    {
      id: "archpaladin-farm",
      label: "Farm Rotation",
      className: "ArchPaladin",
      role: "Farm",
      delayMs: 150,
      cooldownMode: "use-if-ready",
      steps: [
        {
          id: "farm-1",
          skill: 1,
          conditions: [
            {
              type: "self-hp",
              op: "<=",
              value: 80,
              unit: "percent",
            },
          ],
        },
      ],
      messageTriggers: [
        {
          id: "trigger-1",
          messageIncludes: "enrage",
          skill: 5,
          source: "animation",
          cooldownMs: 1_000,
        },
      ],
    },
  ],
} satisfies CombatProfileLibrary;

describe("combatProfiles", () => {
  it("keeps canonical libraries stable", () => {
    expect(
      Schema.decodeUnknownSync(CombatProfileLibrarySchema)(canonicalLibrary),
    ).toEqual(canonicalLibrary);
    expect(normalizeCombatProfileLibrary(canonicalLibrary)).toEqual(
      canonicalLibrary,
    );
    expect(serializeCombatProfileLibrary(canonicalLibrary)).toEqual(
      canonicalLibrary,
    );
  });

  it("normalizes library envelopes around the generic profile", () => {
    const normalized = normalizeCombatProfileLibrary({
      profiles: [
        { id: "custom", label: "Custom", steps: [{ skill: 1 }] },
        { label: "No Id", steps: [{ skill: 2 }] },
        { id: "dupe", label: "First", steps: [{ skill: 1 }] },
        { id: "dupe", label: "Second", steps: [{ skill: 2 }] },
        {
          id: DEFAULT_COMBAT_PROFILE_ID,
          label: "Generic Custom",
          steps: [{ skill: 3 }],
        },
      ],
    });

    expect(normalized.version).toBe(COMBAT_PROFILE_LIBRARY_VERSION);
    expect(normalized.profiles.map((profile) => profile.id)).toEqual([
      DEFAULT_COMBAT_PROFILE_ID,
      "custom",
      "dupe",
      "dupe",
    ]);
    expect(normalized.profiles[0]?.label).toBe("Generic Custom");
  });

  it("rejects future library versions", () => {
    expect(() =>
      normalizeCombatProfileLibrary({
        version: COMBAT_PROFILE_LIBRARY_VERSION + 1,
        profiles: [],
      }),
    ).toThrow(CombatProfileNormalizationError);
  });

  it("trims explicit ids without changing their shape", () => {
    expect(
      normalizeCombatProfile({
        id: " Boss Profile #1 ",
        label: "Boss",
        steps: [{ skill: 1 }],
      }).id,
    ).toBe("Boss Profile #1");
  });

  it("normalizes script profile definitions into runnable profiles", () => {
    const definition = { steps: [{ skill: 1, skipIfUnavailable: true }] };

    expect(isCombatProfileDefinition(definition)).toBe(true);
    expect(normalizeCombatProfile(definition)).toEqual({
      id: DEFAULT_COMBAT_PROFILE_ID,
      label: "Profile",
      role: "Base",
      delayMs: 150,
      cooldownMode: "use-if-ready",
      steps: [
        {
          id: "step-1",
          skill: 1,
          conditions: [],
          cooldownMode: "use-if-ready",
        },
      ],
    });
  });

  it("uses the generic profile as the lookup fallback", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [{ id: "custom", label: "Custom", steps: [{ skill: 1 }] }],
    });

    expect(getCombatProfileById(library, "missing").id).toBe(
      DEFAULT_COMBAT_PROFILE_ID,
    );
  });
});
