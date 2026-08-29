import { describe, expect, it } from "vitest";

import {
  parseEnvironmentQuestBulkInput,
  splitEnvironmentBulkInput,
} from "./input";

describe("Environment bulk input", () => {
  it("splits semicolon-separated entries without treating commas specially", () => {
    expect(
      splitEnvironmentBulkInput(
        " Vok, the Tundra Blade; ; Cape of 1,000 Bones ",
      ),
    ).toEqual(["Vok, the Tundra Blade", "Cape of 1,000 Bones"]);
  });

  it("parses quest IDs with optional reward item IDs", () => {
    expect(parseEnvironmentQuestBulkInput("12; 34:56; ; 78:")).toEqual([
      { questId: 12 },
      { questId: 34, rewardItemId: 56 },
      { questId: 78 },
    ]);
  });
});
