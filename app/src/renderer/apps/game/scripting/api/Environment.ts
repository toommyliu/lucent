import type { EnvironmentShape } from "../../environment/Environment";
import type { ScriptEnvironmentApi } from "../ScriptApi";

export const makeScriptEnvironmentApi = (
  environment: EnvironmentShape,
): ScriptEnvironmentApi => ({
  addBoost: environment.addBoost,
  addItem: environment.addItem,
  addQuest: environment.addQuest,
  clear: environment.clear,
  clearBoosts: environment.clearBoosts,
  clearItems: environment.clearItems,
  clearQuestReward: environment.clearQuestReward,
  clearQuests: environment.clearQuests,
  fetchBoosts: environment.fetchBoosts,
  getState: environment.getState,
  removeBoost: environment.removeBoost,
  removeItem: environment.removeItem,
  removeQuest: environment.removeQuest,
  setAcceptAcMemberOnlyDrops: environment.setAcceptAcMemberOnlyDrops,
  setAcceptAcNonMemberDrops: environment.setAcceptAcNonMemberDrops,
  setAcceptNonAcMemberOnlyDrops: environment.setAcceptNonAcMemberOnlyDrops,
  setAcceptNonAcNonMemberDrops: environment.setAcceptNonAcNonMemberDrops,
  setAutoRegisterRequirements: environment.setAutoRegisterRequirements,
  setAutoRegisterRewards: environment.setAutoRegisterRewards,
  setBoostAutomationEnabled: environment.setBoostAutomationEnabled,
  setDropAutomationEnabled: environment.setDropAutomationEnabled,
  setDropPolicy: environment.setDropPolicy,
  setItemNotification: environment.setItemNotification,
  setQuestAutomationEnabled: environment.setQuestAutomationEnabled,
  setQuestReward: environment.setQuestReward,
  setRejectUnregisteredDrops: environment.setRejectUnregisteredDrops,
  syncToAll: environment.syncToAll,
});
