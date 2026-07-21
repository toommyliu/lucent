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
    if (!questId?.trim()) {
      return [];
    }

    return [
      {
        questId: questId.trim(),
        ...(rewardItemId?.trim() ? { rewardItemId: rewardItemId.trim() } : {}),
      },
    ];
  });
