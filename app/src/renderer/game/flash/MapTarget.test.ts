import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  hasFixedRoomSuffix,
  parseMapTarget,
  withPrivateRoom,
} from "./MapTarget";

describe("MapTarget", () => {
  it.effect("coerces nonnumeric room suffixes into random numeric rooms", () =>
    Effect.gen(function* () {
      const target = yield* parseMapTarget("doomvaultb-1e99");

      expect(hasFixedRoomSuffix("doomvaultb-1e99")).toBe(false);
      expect(withPrivateRoom("doomvaultb-1e99", 12345)).toBe(
        "doomvaultb-12345",
      );
      expect(target.name).toBe("doomvaultb");
      expect(target.requireExactRoom).toBe(true);
      expect(target.roomNumber).toBeGreaterThanOrEqual(10_000);
      expect(target.roomNumber).toBeLessThanOrEqual(99_999);
      expect(target.roomToken).toBe(String(target.roomNumber));
      expect(target.map).toBe(`doomvaultb-${target.roomNumber}`);
    }),
  );

  it("adds private rooms only to bare map names", () => {
    expect(hasFixedRoomSuffix("doomvaultb")).toBe(false);
    expect(withPrivateRoom("doomvaultb", 12345)).toBe("doomvaultb-12345");
  });

  it.effect("requires exact room checks for numeric room suffixes", () =>
    Effect.gen(function* () {
      expect(hasFixedRoomSuffix("battleon-9001")).toBe(true);
      expect(withPrivateRoom("battleon-9001", 12345)).toBe("battleon-9001");
      expect(yield* parseMapTarget("battleon-9001")).toEqual({
        map: "battleon-9001",
        name: "battleon",
        requireExactRoom: true,
        roomNumber: 9001,
        roomToken: "9001",
      });
    }),
  );
});
