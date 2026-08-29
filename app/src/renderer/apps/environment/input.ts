import type { EnvironmentQuestRegistration } from "@lucent/core/environment";

export const splitEnvironmentBulkInput = (value: string): string[] =>
  value
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean);

export const parseEnvironmentQuestBulkInput = (
  value: string,
): readonly EnvironmentQuestRegistration[] =>
  splitEnvironmentBulkInput(value).flatMap((token) => {
    const [questId, rewardItemId] = token.split(":");
    const parsedQuestId = Number(questId?.trim());
    if (!Number.isSafeInteger(parsedQuestId) || parsedQuestId <= 0) {
      return [];
    }

    const parsedRewardItemId = Number(rewardItemId?.trim());

    return [
      {
        questId: parsedQuestId,
        ...(Number.isSafeInteger(parsedRewardItemId) && parsedRewardItemId > 0
          ? { rewardItemId: parsedRewardItemId }
          : {}),
      },
    ];
  });
