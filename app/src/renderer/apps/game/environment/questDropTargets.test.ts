import { LiveQuest } from "@lucent/game";
import { describe, expect, it } from "vitest";

import { getQuestDropTargetNames } from "./questDropTargets";

describe("Environment quest drop targets", () => {
  it("includes rewards and only explicitly non-temporary requirements", () => {
    const quest = new LiveQuest({
      cadence: "none",
      id: 1,
      name: "Targets",
      once: false,
      requirements: [
        {
          itemId: 1,
          name: "Permanent",
          quantity: 1,
          temporaryItem: false,
        },
        {
          itemId: 2,
          name: "Temporary",
          quantity: 1,
          temporaryItem: true,
        },
        {
          itemId: 3,
          name: "Unknown",
          quantity: 1,
        },
      ],
      rewards: [
        {
          itemId: 4,
          name: "Reward",
          quantity: 1,
        },
        {
          itemId: 5,
          name: "permanent",
          quantity: 1,
        },
      ],
    });

    expect(
      getQuestDropTargetNames(quest, {
        requirements: true,
        rewards: true,
      }),
    ).toEqual(["Reward", "permanent"]);
    expect(
      getQuestDropTargetNames(quest, {
        requirements: true,
        rewards: false,
      }),
    ).toEqual(["Permanent"]);
  });
});
