import { describe, expect, it } from "@effect/vitest";

import {
  haveSameAccountUsernames,
  resolveSelectedAccountUsernames,
} from "./accountSelection";

describe("account selection", () => {
  it("returns selected usernames in account order", () => {
    expect(
      resolveSelectedAccountUsernames(
        [{ username: "Alpha" }, { username: "Beta" }, { username: "Gamma" }],
        new Set(["Gamma", "missing", "Alpha"]),
      ),
    ).toEqual(["Alpha", "Gamma"]);
  });

  it("compares username sets without depending on insertion order", () => {
    expect(
      haveSameAccountUsernames(
        new Set(["Alpha", "Beta"]),
        new Set(["Beta", "Alpha"]),
      ),
    ).toBe(true);
    expect(
      haveSameAccountUsernames(new Set(["Alpha"]), new Set(["Alpha", "Beta"])),
    ).toBe(false);
  });
});
