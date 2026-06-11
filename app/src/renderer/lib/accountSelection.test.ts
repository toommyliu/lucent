import { describe, expect, it } from "vitest";
import { resolveSelectedAccountUsernames } from "./accountSelection";

describe("resolveSelectedAccountUsernames", () => {
  it("includes selected accounts that are hidden by the active search filter", () => {
    const accounts = [
      { username: "alpha" },
      { username: "bravo" },
      { username: "charlie" },
    ];
    const filteredAccounts = accounts.filter((account) =>
      account.username.includes("br"),
    );
    const selectedUsernames = new Set(["alpha", "charlie"]);

    expect(filteredAccounts).toEqual([{ username: "bravo" }]);
    expect(
      resolveSelectedAccountUsernames(accounts, selectedUsernames),
    ).toEqual(["alpha", "charlie"]);
  });

  it("preserves account order and ignores stale selections", () => {
    expect(
      resolveSelectedAccountUsernames(
        [{ username: "bravo" }, { username: "alpha" }],
        new Set(["missing", "alpha", "bravo"]),
      ),
    ).toEqual(["bravo", "alpha"]);
  });
});
