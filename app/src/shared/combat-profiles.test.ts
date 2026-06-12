import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  autoAttackStateToProfileRef,
  cloneCombatProfileLibrary,
  findCombatProfileBySelector,
  findCombatProfileByRef,
  getCombatProfileBySelector,
  normalizeCombatProfile,
  normalizeCombatProfileLibrary,
  parseCombatProfileAutoAttackState,
} from "./combat-profiles";

describe("combat profile library", () => {
  it("seeds the generic profile for missing input", () => {
    const library = normalizeCombatProfileLibrary(undefined);

    expect(library.profiles).toEqual([
      expect.objectContaining({
        id: DEFAULT_COMBAT_PROFILE_ID,
        label: "Generic",
        steps: [
          expect.objectContaining({ skill: 1 }),
          expect.objectContaining({ skill: 2 }),
          expect.objectContaining({ skill: 3 }),
          expect.objectContaining({ skill: 4 }),
        ],
      }),
    ]);
    expect(library.autoAttack).toEqual({ mode: "equipped-class" });
  });

  it("normalizes profiles without mirroring class-name keyed storage", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [
        {
          id: "vhl-solo",
          label: "Void Highlord Solo",
          className: "  Void   Highlord ",
          role: "Solo",
          delayMs: 250.9,
          cooldownMode: "wait-for-cooldown",
          timeoutMs: 20_500.5,
          resetSkillIndexOnMonsterDeath: true,
          steps: [
            {
              id: "heal",
              skill: 4,
              conditions: [
                {
                  type: "self-hp",
                  op: "<=",
                  value: 60,
                  unit: "percent",
                },
                {
                  type: "target-aura",
                  auraName: "  Shred ",
                  op: ">=",
                  value: 1,
                },
              ],
              cooldownMode: "wait-for-cooldown",
              waitMs: 100,
            },
          ],
          animationTriggers: [
            {
              id: "nuke",
              messageIncludes: "  Boss prepares ",
              skill: 5.9,
              cooldownMs: 2500.5,
            },
            {
              messageIncludes: "",
              skill: 4,
            },
          ],
        },
      ],
      autoAttack: {
        mode: "selected",
        selectedProfileId: "vhl-solo",
      },
    });

    expect(library.profiles[1]).toEqual({
      id: "vhl-solo",
      label: "Void Highlord Solo",
      className: "Void   Highlord",
      role: "Solo",
      delayMs: 250,
      cooldownMode: "wait-for-cooldown",
      timeoutMs: 20_500,
      resetSkillIndexOnMonsterDeath: true,
      steps: [
        {
          id: "heal",
          skill: 4,
          conditions: [
            {
              type: "self-hp",
              op: "<=",
              value: 60,
              unit: "percent",
            },
            {
              type: "target-aura",
              auraName: "Shred",
              op: ">=",
              value: 1,
            },
          ],
          cooldownMode: "wait-for-cooldown",
          waitMs: 100,
        },
      ],
      animationTriggers: [
        {
          id: "nuke",
          messageIncludes: "Boss prepares",
          skill: 5,
          cooldownMs: 2500,
        },
      ],
    });
    expect(autoAttackStateToProfileRef(library.autoAttack)).toEqual({
      mode: "selected",
      profileId: "vhl-solo",
    });
  });

  it("defaults reset-on-death to disabled and clones enabled profiles", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [
        {
          id: "default-reset",
          label: "Default Reset",
          resetSkillIndexOnMonsterDeath: "true",
          steps: [{ skill: 1 }],
        },
        {
          id: "enabled-reset",
          label: "Enabled Reset",
          resetSkillIndexOnMonsterDeath: true,
          steps: [{ skill: 2 }],
        },
      ],
    });

    expect(library.profiles[1]).not.toHaveProperty(
      "resetSkillIndexOnMonsterDeath",
    );
    expect(library.profiles[2]?.resetSkillIndexOnMonsterDeath).toBe(true);
    expect(
      cloneCombatProfileLibrary(library).profiles[2]
        ?.resetSkillIndexOnMonsterDeath,
    ).toBe(true);
  });

  it("falls back to generic when a selected profile no longer exists", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [],
      autoAttack: {
        mode: "selected",
        selectedProfileId: "missing",
      },
    });

    expect(library.autoAttack).toEqual({ mode: "equipped-class" });
    expect(
      findCombatProfileByRef(library, {
        mode: "selected",
        profileId: "missing",
      }).id,
    ).toBe(DEFAULT_COMBAT_PROFILE_ID);
  });

  it("strictly parses auto attack IPC payloads", () => {
    const profileIds = new Set([DEFAULT_COMBAT_PROFILE_ID, "vhl-solo"]);

    expect(
      parseCombatProfileAutoAttackState(
        { mode: "selected", selectedProfileId: "vhl-solo" },
        profileIds,
      ),
    ).toEqual({ mode: "selected", selectedProfileId: "vhl-solo" });
    expect(() =>
      parseCombatProfileAutoAttackState(
        { mode: "selected", selectedProfileId: "missing" },
        profileIds,
      ),
    ).toThrow("Selected combat profile does not exist");
    expect(() =>
      parseCombatProfileAutoAttackState({ mode: "invalid" }, profileIds),
    ).toThrow("Auto attack state mode is invalid");
  });

  it("resolves equipped-class profiles case-insensitively", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [
        {
          id: "archmage-farm",
          label: "ArchMage Farm",
          className: "ArchMage",
          role: "Farm",
          steps: [{ skill: 3 }],
        },
      ],
    });

    expect(
      findCombatProfileByRef(library, "equipped-class", "archmage").id,
    ).toBe("archmage-farm");
    expect(
      findCombatProfileByRef(library, "equipped-class", "void highlord").id,
    ).toBe(DEFAULT_COMBAT_PROFILE_ID);
  });

  it("maps legacy step skip flags to per-step cooldown mode", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [
        {
          id: "legacy",
          label: "Legacy",
          cooldownMode: "wait-for-cooldown",
          steps: [
            {
              skill: 4,
              skipIfUnavailable: true,
            },
          ],
        },
      ],
    });

    expect(library.profiles[1]?.steps[0]).toEqual({
      id: "step-1",
      skill: 4,
      conditions: [],
      cooldownMode: "use-if-ready",
    });
  });

  it("normalizes inline combat profile definitions without saving them", () => {
    const profile = normalizeCombatProfile({
      label: "Inline",
      delayMs: 75.9,
      cooldownMode: "wait-for-cooldown",
      steps: [{ skill: 4.8 }],
    });

    expect(profile).toEqual({
      id: "inline",
      label: "Inline",
      role: "Base",
      delayMs: 75,
      cooldownMode: "wait-for-cooldown",
      timeoutMs: 10_000,
      steps: [{ id: "step-1", skill: 4, conditions: [] }],
    });
  });

  it("finds profiles by script selector shapes", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [
        {
          id: "archmage-farm",
          label: "ArchMage Farm",
          className: "ArchMage",
          steps: [{ skill: 2 }],
        },
      ],
    });

    expect(findCombatProfileBySelector(library, "archmage-farm")?.id).toBe(
      "archmage-farm",
    );
    expect(findCombatProfileBySelector(library, "archmage farm")?.id).toBe(
      "archmage-farm",
    );
    expect(
      findCombatProfileBySelector(library, { label: "ARCHMAGE FARM" })?.id,
    ).toBe("archmage-farm");
    expect(
      findCombatProfileBySelector(library, { className: "archmage" })?.id,
    ).toBe("archmage-farm");
    expect(
      findCombatProfileBySelector(library, "equipped-class", "ArchMage")?.id,
    ).toBe("archmage-farm");
  });

  it("falls back to generic for missing script profile gets", () => {
    const library = normalizeCombatProfileLibrary({
      profiles: [
        {
          id: "solo",
          label: "Solo",
          steps: [{ skill: 4 }],
        },
      ],
    });

    expect(findCombatProfileBySelector(library, "missing")).toBeUndefined();
    expect(getCombatProfileBySelector(library, "missing").id).toBe(
      DEFAULT_COMBAT_PROFILE_ID,
    );
  });
});
