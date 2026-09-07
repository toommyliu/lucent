import { describe, expect, it } from "@effect/vitest";

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
  it("is silent on full success and includes withdrawal and failure counts", () => {
    expect(environmentBoostWithdrawalSummary(3, 3)).toBe("");
    expect(environmentBoostWithdrawalSummary(4, 3)).toMatch(/3.*1/);
    expect(environmentBoostWithdrawalSummary(4, 3)).toMatch(
      /could not|failed/i,
    );
    expect(environmentBoostWithdrawalSummary(2, 0)).toMatch(/2/);
    expect(environmentBoostWithdrawalSummary(2, 0)).toMatch(
      /could not|failed/i,
    );
  });
});
