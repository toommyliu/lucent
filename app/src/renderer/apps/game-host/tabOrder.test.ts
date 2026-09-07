import { describe, expect, it } from "@effect/vitest";

import {
  gameViewTabNavigationTargetId,
  reorderedGameViewIds,
} from "./tabOrder";

describe("game view tab keyboard navigation", () => {
  const ids = ["a", "b", "c"];

  it.each([
    ["b", "ArrowLeft", "a"],
    ["a", "ArrowLeft", "c"],
    ["b", "ArrowRight", "c"],
    ["c", "ArrowRight", "a"],
    ["b", "Home", "a"],
    ["b", "End", "c"],
  ] as const)("navigates from %s using %s to %s", (current, key, expected) => {
    expect(gameViewTabNavigationTargetId(ids, current, key)).toBe(expected);
  });
});

describe("game view tab order", () => {
  it("moves one tab relative to the drop target", () => {
    expect(reorderedGameViewIds(["a", "b", "c"], ["a"], "c", "after")).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("moves selected tabs together in their existing order", () => {
    expect(
      reorderedGameViewIds(["a", "b", "c", "d", "e"], ["d", "b"], "e", "after"),
    ).toEqual(["a", "c", "e", "b", "d"]);
  });

  it("leaves the order unchanged when the target is being dragged", () => {
    const ids = ["a", "b", "c"];

    expect(reorderedGameViewIds(ids, ["a", "b"], "b", "after")).toBe(ids);
  });
});
