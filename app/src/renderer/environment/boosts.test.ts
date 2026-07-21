import { describe, expect, it } from "vitest";

import {
  environmentBoostWithdrawalSummary,
  prepareEnvironmentBankBoosts,
} from "./boosts";

describe("prepareEnvironmentBankBoosts", () => {
  it("deduplicates, sorts, and labels already registered boosts", () => {
    expect(
      prepareEnvironmentBankBoosts(
        [
          { itemId: 2, name: " XP Boost ", quantity: 4 },
          { itemId: 3, name: "Gold Boost", quantity: 2 },
          { itemId: 4, name: "xp boost", quantity: 8 },
        ],
        ["XP BOOST"],
      ),
    ).toEqual([
      {
        alreadyAdded: false,
        itemId: 3,
        name: "Gold Boost",
        quantity: 2,
      },
      {
        alreadyAdded: true,
        itemId: 2,
        name: "XP Boost",
        quantity: 4,
      },
    ]);
  });
});

describe("environmentBoostWithdrawalSummary", () => {
  it("is silent on full success and summarizes partial or total failure", () => {
    expect(environmentBoostWithdrawalSummary(3, 3)).toBe("");
    expect(environmentBoostWithdrawalSummary(4, 3)).toBe(
      "Withdrew 3 boosts; 1 could not be withdrawn.",
    );
    expect(environmentBoostWithdrawalSummary(2, 0)).toBe(
      "Could not withdraw 2 selected boosts.",
    );
  });
});
