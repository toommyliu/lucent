import { describe, expect, it } from "@effect/vitest";

import { parseRoomNumberInput, roomNumberKind } from "./roomPolicyInput";

describe("room policy input", () => {
  it.each([
    ["1", 1, "public"],
    ["1000", 1000, "public"],
    ["1001", 1001, "private"],
    ["99999", 99999, "private"],
  ] as const)("accepts room %s as %s (%s)", (input, value, kind) => {
    expect(parseRoomNumberInput(input)).toEqual({ status: "valid", value });
    expect(roomNumberKind(value)).toBe(kind);
  });

  it("rejects blank, out-of-range, and non-integer values", () => {
    for (const input of ["", "0", "100000", "1.5", "room"]) {
      expect(parseRoomNumberInput(input)).toEqual({ status: "invalid" });
    }
  });
});
