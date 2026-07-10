import { describe, expect, it } from "vitest";

import { normalizeItemSelector } from "./selectors";

describe("item selectors", () => {
  it("treats strings as names and numbers as item ids", () => {
    expect(normalizeItemSelector("123")).toEqual({ name: "123" });
    expect(normalizeItemSelector(123)).toEqual({ itemId: 123 });
  });
});
