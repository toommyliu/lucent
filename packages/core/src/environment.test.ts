import { describe, expect, it } from "vitest";

import {
  addEnvironmentBoosts,
  addEnvironmentItem,
  addEnvironmentItems,
  addEnvironmentQuest,
  addEnvironmentQuests,
  classifyEnvironmentDropItem,
  clearEnvironmentItems,
  clearEnvironmentState,
  createEmptyEnvironmentState,
  environmentDropPolicyToItemRules,
  environmentItemRulesToDropPolicy,
  normalizeEnvironmentState,
  removeEnvironmentBoost,
  removeEnvironmentItem,
  resolveEnvironmentDropAction,
  setEnvironmentAutomationEnabled,
  setEnvironmentDropPolicy,
  setEnvironmentItemNotification,
  setEnvironmentQuestReward,
} from "./environment";

describe("Environment", () => {
  it("normalizes quest state and treats invalid identifiers as no-ops", () => {
    const initial = normalizeEnvironmentState({
      ...createEmptyEnvironmentState(),
      questIds: [9, 2, 9, -1],
      questRewards: { 2: 30, 4: 40, 9: -1 },
    });

    expect(initial.questIds).toEqual([2, 9]);
    expect(initial.questRewards).toEqual({ 2: 30 });
    expect(addEnvironmentQuest(initial, "invalid")).toEqual(initial);
    expect(addEnvironmentQuest(initial, "1.0")).toEqual(initial);
    expect(addEnvironmentQuest(initial, "1e3")).toEqual(initial);
    expect(setEnvironmentQuestReward(initial, 2, 0)).toEqual(initial);
    expect(addEnvironmentQuest(initial, 4.9).questIds).toEqual([2, 4, 9]);
    expect(addEnvironmentQuest(initial, " 4 ", " 41 ")).toMatchObject({
      questIds: [2, 4, 9],
      questRewards: { 2: 30, 4: 41 },
    });
  });

  it("deduplicates item and boost names case-insensitively", () => {
    let state = createEmptyEnvironmentState();
    state = addEnvironmentItems(state, ["  Burning Blade ", "burning blade"]);
    state = addEnvironmentBoosts(state, [" XP Boost ", "xp boost"]);

    expect(state.itemNames).toEqual(["Burning Blade"]);
    expect(state.boosts).toEqual(["XP Boost"]);
    expect(removeEnvironmentItem(state, "BURNING BLADE").itemNames).toEqual([]);
    expect(removeEnvironmentBoost(state, "Xp Boost").boosts).toEqual([]);
  });

  it("adds quest registrations atomically", () => {
    const state = addEnvironmentQuests(createEmptyEnvironmentState(), [
      { questId: "4", rewardItemId: "41" },
      { questId: 2 },
      { questId: "invalid", rewardItemId: 99 },
    ]);

    expect(state.questIds).toEqual([2, 4]);
    expect(state.questRewards).toEqual({ 4: 41 });
  });

  it("keeps notification names registered and normalized", () => {
    let state = addEnvironmentItem(
      createEmptyEnvironmentState(),
      "Vok, the Tundra Blade",
    );
    state = setEnvironmentItemNotification(
      state,
      "vok, THE tundra blade",
      true,
    );

    expect(state.itemNotificationNames).toEqual(["Vok, the Tundra Blade"]);
    expect(
      setEnvironmentItemNotification(state, "Not Registered", true),
    ).toEqual(state);
    expect(
      removeEnvironmentItem(state, "Vok, the Tundra Blade")
        .itemNotificationNames,
    ).toEqual([]);
  });

  it("clears configured entries without resetting behavior options", () => {
    let state = normalizeEnvironmentState({
      ...createEmptyEnvironmentState(),
      automation: { boosts: false, drops: false, quests: false },
      boosts: ["XP Boost"],
      itemNames: ["Quest Drop"],
      itemNotificationNames: ["Quest Drop"],
      itemRules: { buckets: ["ac-non-member"], rejectElse: true },
      questAutoRegister: { requirements: true, rewards: true },
      questIds: [1],
      questRewards: { 1: 2 },
    });

    expect(clearEnvironmentItems(state)).toMatchObject({
      itemNames: [],
      itemNotificationNames: [],
      itemRules: { buckets: ["ac-non-member"], rejectElse: true },
    });

    state = clearEnvironmentState(state);
    expect(state).toMatchObject({
      automation: { boosts: false, drops: false, quests: false },
      boosts: [],
      itemNames: [],
      itemNotificationNames: [],
      itemRules: { buckets: ["ac-non-member"], rejectElse: true },
      questAutoRegister: { requirements: true, rewards: true },
      questIds: [],
      questRewards: {},
    });
  });

  it("normalizes automation options", () => {
    const state = setEnvironmentAutomationEnabled(
      createEmptyEnvironmentState(),
      "boosts",
      false,
    );

    expect(state.automation).toEqual({
      boosts: false,
      drops: true,
      quests: true,
    });
  });

  it("maps all item buckets to the public drop policy", () => {
    const rules = environmentDropPolicyToItemRules({
      acceptAcMemberOnlyDrops: true,
      acceptAcNonMemberDrops: false,
      acceptNonAcMemberOnlyDrops: true,
      acceptNonAcNonMemberDrops: false,
      rejectUnregisteredDrops: true,
    });

    expect(rules).toEqual({
      buckets: ["ac-member", "non-ac-member"],
      rejectElse: true,
    });
    expect(environmentItemRulesToDropPolicy(rules)).toEqual({
      acceptAcMemberOnlyDrops: true,
      acceptAcNonMemberDrops: false,
      acceptNonAcMemberOnlyDrops: true,
      acceptNonAcNonMemberDrops: false,
      rejectUnregisteredDrops: true,
    });
    expect(
      setEnvironmentDropPolicy(createEmptyEnvironmentState(), {
        acceptAcNonMemberDrops: true,
      }).itemRules.buckets,
    ).toEqual(["ac-non-member"]);
  });

  it("classifies buckets and gives registered names precedence", () => {
    expect(
      classifyEnvironmentDropItem({
        coins: true,
        memberOnly: true,
        name: "One",
      }),
    ).toBe("ac-member");
    expect(
      classifyEnvironmentDropItem({
        coins: true,
        memberOnly: false,
        name: "Two",
      }),
    ).toBe("ac-non-member");
    expect(
      classifyEnvironmentDropItem({
        coins: false,
        memberOnly: true,
        name: "Three",
      }),
    ).toBe("non-ac-member");
    expect(
      classifyEnvironmentDropItem({
        coins: false,
        memberOnly: false,
        name: "Four",
      }),
    ).toBe("non-ac-non-member");

    const state = {
      ...createEmptyEnvironmentState(),
      itemNames: ["Keep Me"],
      itemRules: { buckets: [], rejectElse: true },
    };
    expect(
      resolveEnvironmentDropAction(state, {
        coins: false,
        memberOnly: false,
        name: "keep me",
      }),
    ).toBe("accept");
    expect(
      resolveEnvironmentDropAction(state, {
        coins: false,
        memberOnly: false,
        name: "Other",
      }),
    ).toBe("reject");
  });
});
