import { describe, expect, it } from "@effect/vitest";

import { resolveSelectedAccountUsernames } from "./accountSelection";

describe("account selection", () => {
  it("returns selected usernames in account order", () => {
    expect(
      resolveSelectedAccountUsernames(
        [{ username: "Alpha" }, { username: "Beta" }, { username: "Gamma" }],
        new Set(["Gamma", "missing", "Alpha"]),
      ),
    ).toEqual(["Alpha", "Gamma"]);
  });
});
