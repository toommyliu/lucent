import { describe, expect, it } from "vitest";

import {
  buildVisibleTreeItems,
  filterTreeRoots,
  toTreeJson,
  type TreeItem,
} from "./tree";

const data: readonly TreeItem[] = [
  {
    children: [
      { name: "ID", value: "10" },
      { name: "Description", value: "A bright blade" },
    ],
    name: "Sword",
    raw: { itemId: 10, name: "Sword" },
  },
  {
    children: [{ name: "ID", value: "20" }],
    name: "Shield",
  },
];

describe("Loader grabber tree", () => {
  it("flattens only explicitly expanded nodes when not searching", () => {
    const visible = buildVisibleTreeItems(data, new Set(["0"]), "");
    expect(visible.items.map((item) => item.nodeId)).toEqual([
      "0",
      "0.0",
      "0.1",
      "1",
    ]);
    expect(visible.matchedRootCount).toBe(2);
  });

  it("includes and expands ancestors for matching descendants", () => {
    const visible = buildVisibleTreeItems(data, new Set(), "bright");
    expect(visible.items.map((item) => item.nodeId)).toEqual(["0", "0.1"]);
    expect(visible.autoExpandedNodeIds).toEqual(new Set(["0"]));
    expect(visible.matchedRootCount).toBe(1);
  });

  it("filters roots by names and descendant values", () => {
    expect(filterTreeRoots(data, "sword").map((root) => root.nodeId)).toEqual([
      "0",
    ]);
    expect(filterTreeRoots(data, "20").map((root) => root.nodeId)).toEqual([
      "1",
    ]);
    expect(filterTreeRoots(data, "")).toHaveLength(2);
  });

  it("exports raw domain data when it is available", () => {
    expect(toTreeJson(data[0]!)).toEqual({ itemId: 10, name: "Sword" });
    expect(toTreeJson(data[1]!)).toEqual({
      children: [{ name: "ID", value: "20" }],
      name: "Shield",
    });
  });
});
