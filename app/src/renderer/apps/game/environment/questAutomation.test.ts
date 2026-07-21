import { describe, expect, it } from "vitest";

import {
  canRunQuestAction,
  clearQuestActionFailure,
  createQuestAutomationIntent,
  getQuestMutationDelayMs,
  recordQuestActionFailure,
} from "./questAutomation";

describe("Environment quest automation helpers", () => {
  it("derives accept, complete, and no-op intents", () => {
    expect(
      createQuestAutomationIntent({
        available: true,
        canComplete: false,
        inProgress: false,
        questId: 1,
      }),
    ).toEqual({ action: "accept", questId: 1 });
    expect(
      createQuestAutomationIntent({
        available: false,
        canComplete: true,
        inProgress: true,
        questId: 2,
        rewardItemId: 20,
      }),
    ).toEqual({
      action: "complete",
      questId: 2,
      rewardItemId: 20,
    });
    expect(
      createQuestAutomationIntent({
        available: true,
        canComplete: false,
        inProgress: true,
        questId: 3,
      }),
    ).toEqual({ action: "none", questId: 3 });
  });

  it("backs failed actions off at 2, 5, then 15 seconds", () => {
    let failures = new Map();
    failures = new Map(recordQuestActionFailure(failures, "quest", 1_000));
    expect(canRunQuestAction(failures, "quest", 2_999)).toBe(false);
    expect(canRunQuestAction(failures, "quest", 3_000)).toBe(true);

    failures = new Map(recordQuestActionFailure(failures, "quest", 3_000));
    expect(failures.get("quest")?.retryAfter).toBe(8_000);
    failures = new Map(recordQuestActionFailure(failures, "quest", 8_000));
    expect(failures.get("quest")?.retryAfter).toBe(23_000);
    failures = new Map(recordQuestActionFailure(failures, "quest", 23_000));
    expect(failures.get("quest")?.retryAfter).toBe(38_000);
    expect(clearQuestActionFailure(failures, "quest").has("quest")).toBe(false);
  });

  it("spaces serialized mutations by the remaining delay", () => {
    expect(getQuestMutationDelayMs(1_000, 1_200)).toBe(550);
    expect(getQuestMutationDelayMs(1_000, 2_000)).toBe(0);
  });
});
