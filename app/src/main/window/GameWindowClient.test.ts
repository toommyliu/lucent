import { describe, expect, it } from "@effect/vitest";
import { isPendingResponseOwner } from "./GameWindowClient";
import { makeGameWindowRef } from "./WindowTypes";

describe("GameWindowClient routing policy", () => {
  it("accepts responses from the owning game window", () => {
    expect(isPendingResponseOwner(12, makeGameWindowRef(12))).toBe(true);
  });

  it("rejects responses from another game window", () => {
    expect(isPendingResponseOwner(12, makeGameWindowRef(13))).toBe(false);
  });
});
