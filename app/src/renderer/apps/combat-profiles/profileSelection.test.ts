import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  type CombatProfile,
} from "@lucent/core/combatProfiles";

import { resolvePreferredCombatProfileId } from "./profileSelection";

const combatProfile = (id: string): CombatProfile => ({
  id,
  label: id,
  delayMs: 150,
  cooldownMode: "use-if-ready",
  steps: [],
});

describe("combat profile selection", () => {
  it.each([
    {
      ids: [DEFAULT_COMBAT_PROFILE_ID, "preferred"],
      preferred: "preferred",
      fallback: undefined,
      expected: "preferred",
    },
    {
      ids: [DEFAULT_COMBAT_PROFILE_ID, "custom"],
      preferred: "missing",
      fallback: undefined,
      expected: "custom",
    },
    {
      ids: [DEFAULT_COMBAT_PROFILE_ID],
      preferred: "missing",
      fallback: undefined,
      expected: DEFAULT_COMBAT_PROFILE_ID,
    },
    {
      ids: [],
      preferred: undefined,
      fallback: undefined,
      expected: DEFAULT_COMBAT_PROFILE_ID,
    },
    {
      ids: [],
      preferred: undefined,
      fallback: "fallback",
      expected: "fallback",
    },
  ])(
    "resolves $ids with preferred $preferred and fallback $fallback to $expected",
    ({ ids, preferred, fallback, expected }) => {
      expect(
        resolvePreferredCombatProfileId(
          ids.map(combatProfile),
          preferred,
          fallback,
        ),
      ).toBe(expected);
    },
  );
});
