import { describe, expect, it } from "@effect/vitest";

import { appendPacketLogBatch } from "./packetLogBuffer";

describe("appendPacketLogBatch", () => {
  it.each([
    { current: [1, 2], batch: [3, 4], limit: 5, expected: [1, 2, 3, 4] },
    { current: [1, 2, 3], batch: [4, 5], limit: 4, expected: [2, 3, 4, 5] },
    { current: [1, 2], batch: [3, 4, 5, 6], limit: 3, expected: [4, 5, 6] },
  ])(
    "preserves capture order within a limit of $limit",
    ({ current, batch, limit, expected }) => {
      expect(appendPacketLogBatch(current, batch, limit)).toEqual(expected);
    },
  );

  it("does not invalidate the log for an empty batch", () => {
    const current = [1, 2];

    expect(appendPacketLogBatch(current, [], 2)).toBe(current);
  });
});
