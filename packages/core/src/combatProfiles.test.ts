import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  COMBAT_PROFILE_LIBRARY_VERSION,
  CombatProfileLibrarySchema,
  CombatProfileNormalizationError,
  DEFAULT_COMBAT_PROFILE_ID,
  duplicateCombatProfile,
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

  it("duplicates profiles with fresh nested ids and a unique label", () => {
    const source = normalizeCombatProfile(canonicalLibrary.profiles[1]!);
    const idCounts = {
      profile: 0,
      step: 0,
      trigger: 0,
    };
    const duplicate = duplicateCombatProfile(
      source,
      [
        ...canonicalLibrary.profiles,
        { ...source, id: "copy-1", label: "Farm Rotation Copy" },
        { ...source, id: "copy-2", label: "Farm Rotation Copy 2" },
      ],
      (prefix) => {
        idCounts[prefix] += 1;
        return `copy-${prefix}-${idCounts[prefix]}`;
      },
    );

    expect(duplicate).toMatchObject({
      id: "copy-profile-1",
      label: "Farm Rotation Copy 3",
      className: "ArchPaladin",
      steps: [{ id: "copy-step-1", skill: 1 }],
      messageTriggers: [{ id: "copy-trigger-1", messageIncludes: "enrage" }],
    });
    expect(duplicate.steps[0]).not.toBe(source.steps[0]);
    expect(duplicate.steps[0]?.conditions[0]).not.toBe(
      source.steps[0]?.conditions[0],
    );
    expect(duplicate.messageTriggers?.[0]?.id).not.toBe(
      source.messageTriggers?.[0]?.id,
    );
    expect(duplicate.messageTriggers?.[0]).not.toBe(
      source.messageTriggers?.[0],
    );
  });
});
