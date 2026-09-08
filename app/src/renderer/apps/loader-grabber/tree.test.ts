import { describe, expect, it } from "@effect/vitest";

import { filterTreeRoots, type TreeItem } from "./tree";

const data: readonly TreeItem[] = [
  {
    children: [
      { name: "ID", value: "10" },
      { name: "Description", value: "A bright blade" },
    ],
    name: "Sword",
  },
  {
    children: [{ name: "ID", value: "20" }],
    name: "Shield",
  },
];

describe("Loader grabber tree", () => {
  it("filters roots by names and descendant values", () => {
    expect(filterTreeRoots(data, "sword").map((root) => root.nodeId)).toEqual([
      "0",
    ]);
    expect(filterTreeRoots(data, "20").map((root) => root.nodeId)).toEqual([
      "1",
    ]);
    expect(filterTreeRoots(data, "")).toHaveLength(2);
  });
});
