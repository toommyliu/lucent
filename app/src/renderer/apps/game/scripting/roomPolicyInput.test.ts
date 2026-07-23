import { describe, expect, it } from "vitest";

import {
  formatRoomNumberInput,
  parseRoomNumberInput,
  roomNumberKind,
} from "./roomPolicyInput";

describe("room policy input", () => {
  it("formats an absent room as blank", () => {
    expect(formatRoomNumberInput(null)).toBe("");
  });

  it("accepts the inclusive specific-room range", () => {
    expect(parseRoomNumberInput("1")).toEqual({
      status: "valid",
      value: 1,
    });
    expect(parseRoomNumberInput("1000")).toEqual({
      status: "valid",
      value: 1_000,
    });
    expect(parseRoomNumberInput("1001")).toEqual({
      status: "valid",
      value: 1_001,
    });
    expect(parseRoomNumberInput("99999")).toEqual({
      status: "valid",
      value: 99_999,
    });
  });

  it("rejects blank, out-of-range, and non-integer values", () => {
    for (const input of ["", "0", "100000", "1.5", "room"]) {
      expect(parseRoomNumberInput(input)).toEqual({ status: "invalid" });
    }
  });

  it("classifies public and private room numbers", () => {
    expect(roomNumberKind(1_000)).toBe("public");
    expect(roomNumberKind(1_001)).toBe("private");
  });
});
