import { describe, expect, it } from "@effect/vitest";

import {
  haveSameAccountUsernames,
  resolveSelectedAccountUsernames,
} from "./accountSelection";

describe("account selection", () => {
  it("reconciles selection in account order and detects membership changes", () => {
    const selected = new Set(["Gamma", "missing", "Alpha"]);
    const resolved = resolveSelectedAccountUsernames(
      [{ username: "Alpha" }, { username: "Beta" }, { username: "Gamma" }],
      selected,
    );
    expect(resolved).toEqual(["Alpha", "Gamma"]);
    expect(haveSameAccountUsernames(selected, new Set(resolved))).toBe(false);
    expect(
      haveSameAccountUsernames(new Set(["Gamma", "Alpha"]), new Set(resolved)),
    ).toBe(true);
    expect(
      haveSameAccountUsernames(new Set(["Beta", "Alpha"]), new Set(resolved)),
    ).toBe(false);
  });
});
