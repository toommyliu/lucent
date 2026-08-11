import { describe, expect, it } from "vitest";

import { appendPacketLogBatch } from "./packetLogBuffer";

describe("appendPacketLogBatch", () => {
  it("appends a batch in capture order", () => {
    expect(appendPacketLogBatch([1, 2], [3, 4], 5)).toEqual([1, 2, 3, 4]);
  });

  it("evicts the oldest entries when the combined log exceeds the limit", () => {
    expect(appendPacketLogBatch([1, 2, 3], [4, 5], 4)).toEqual([2, 3, 4, 5]);
  });

  it("retains only the newest entries from an oversized batch", () => {
    expect(appendPacketLogBatch([1, 2], [3, 4, 5, 6], 3)).toEqual([4, 5, 6]);
  });

  it("does not invalidate the log for an empty batch", () => {
    const current = [1, 2];

    expect(appendPacketLogBatch(current, [], 2)).toBe(current);
  });
});
