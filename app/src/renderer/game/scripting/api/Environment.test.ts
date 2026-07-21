import { createEmptyEnvironmentState } from "@lucent/core/environment";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import type { EnvironmentShape } from "../../environment/Environment";
import { makeScriptEnvironmentApi } from "./Environment";

const state = createEmptyEnvironmentState();
const returnState = () => Effect.succeed(state);

const environment: EnvironmentShape = {
  addBoost: returnState,
  addItem: returnState,
  addQuest: returnState,
  clear: returnState,
  clearBoosts: returnState,
  clearItems: returnState,
  clearQuestReward: returnState,
  clearQuests: returnState,
  fetchBoosts: () => Effect.succeed([]),
  getState: returnState,
  removeBoost: returnState,
  removeItem: returnState,
  removeQuest: returnState,
  setAcceptAcMemberOnlyDrops: returnState,
  setAcceptAcNonMemberDrops: returnState,
  setAcceptNonAcMemberOnlyDrops: returnState,
  setAcceptNonAcNonMemberDrops: returnState,
  setAutoRegisterRequirements: returnState,
  setAutoRegisterRewards: returnState,
  setBoostAutomationEnabled: returnState,
  setDropAutomationEnabled: returnState,
  setDropPolicy: returnState,
  setItemNotification: returnState,
  setItemRules: returnState,
  setQuestAutoRegister: returnState,
  setQuestAutomationEnabled: returnState,
  setQuestReward: returnState,
  setRejectUnregisteredDrops: returnState,
  syncToAll: returnState,
};

describe("makeScriptEnvironmentApi", () => {
  it("exposes the legacy scripting surface without raw bridge setters", () => {
    const api = makeScriptEnvironmentApi(environment);

    expect(Object.keys(api).toSorted()).toEqual([
      "addBoost",
      "addItem",
      "addQuest",
      "clear",
      "clearBoosts",
      "clearItems",
      "clearQuestReward",
      "clearQuests",
      "fetchBoosts",
      "getState",
      "removeBoost",
      "removeItem",
      "removeQuest",
      "setAcceptAcMemberOnlyDrops",
      "setAcceptAcNonMemberDrops",
      "setAcceptNonAcMemberOnlyDrops",
      "setAcceptNonAcNonMemberDrops",
      "setAutoRegisterRequirements",
      "setAutoRegisterRewards",
      "setBoostAutomationEnabled",
      "setDropAutomationEnabled",
      "setDropPolicy",
      "setItemNotification",
      "setQuestAutomationEnabled",
      "setQuestReward",
      "setRejectUnregisteredDrops",
      "syncToAll",
    ]);
    expect("setItemRules" in api).toBe(false);
    expect("setQuestAutoRegister" in api).toBe(false);
  });
});
