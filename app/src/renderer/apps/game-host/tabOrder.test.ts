import { describe, expect, it } from "vitest";

import {
  gameViewTabNavigationTargetId,
  reorderedGameViewIds,
} from "./tabOrder";

describe("game view tab keyboard navigation", () => {
  const ids = ["a", "b", "c"];

  it("moves with arrows and wraps at each end", () => {
    expect(gameViewTabNavigationTargetId(ids, "b", "ArrowLeft")).toBe("a");
    expect(gameViewTabNavigationTargetId(ids, "a", "ArrowLeft")).toBe("c");
    expect(gameViewTabNavigationTargetId(ids, "b", "ArrowRight")).toBe("c");
    expect(gameViewTabNavigationTargetId(ids, "c", "ArrowRight")).toBe("a");
  });

  it("moves to the first or last tab with Home and End", () => {
    expect(gameViewTabNavigationTargetId(ids, "b", "Home")).toBe("a");
    expect(gameViewTabNavigationTargetId(ids, "b", "End")).toBe("c");
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
