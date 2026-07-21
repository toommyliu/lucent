import type { Quest } from "@lucent/game";
import type { EnvironmentQuestAutoRegisterOptions } from "@lucent/core/environment";

const addName = (names: Map<string, string>, name: string): void => {
  const normalized = name.trim();
  if (normalized === "") {
    return;
  }

  const key = normalized.toLowerCase();
  if (!names.has(key)) {
    names.set(key, normalized);
  }
};

export const getQuestDropTargetNames = (
  quest: Quest,
  options: EnvironmentQuestAutoRegisterOptions,
): readonly string[] => {
  const names = new Map<string, string>();

  if (options.rewards) {
    for (const reward of quest.rewards) {
      addName(names, reward.name);
    }
  }

  if (options.requirements) {
    for (const requirement of quest.requirements) {
      if (requirement.temporaryItem === false) {
        addName(names, requirement.name);
      }
    }
  }

  return Array.from(names.values());
};

export const getRegisteredEnvironmentQuests = (
  quests: readonly Quest[],
  questIds: readonly number[],
): readonly Quest[] => {
  const registeredQuestIds = new Set(questIds);
  return quests.filter((quest) => registeredQuestIds.has(quest.id));
};
