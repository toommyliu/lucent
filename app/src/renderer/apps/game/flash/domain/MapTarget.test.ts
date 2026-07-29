import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

import {
  PUBLIC_ROOM_POLICY,
  RANDOM_PRIVATE_ROOM_POLICY,
} from "@lucent/core/accountSettings";
import {
  applyRoomPolicy,
  hasFixedRoom,
  isPrivateRoom,
  isRoomNumber,
  maximumRoom,
  minimumPrivateRoom,
  minimumRandomPrivateRoom,
  parseMapTarget,
  randomPrivateRoom,
  roomPolicyAcceptsRoom,
  withRoomNumber,
} from "./MapTarget";

const withRandomValue = <A>(effect: Effect.Effect<A>, value: number) =>
  effect.pipe(
    Effect.provideService(Random.Random, {
      nextDoubleUnsafe: () => value,
      nextIntUnsafe: () => 0,
    }),
  );

describe("MapTarget", () => {
  it.effect("distinguishes public rooms from exact rooms", () =>
    Effect.gen(function* () {
      expect(yield* parseMapTarget(" battleon ")).toEqual({
        map: "battleon",
        name: "battleon",
        requireExactRoom: false,
      });

      expect(yield* parseMapTarget("battleon-1")).toEqual({
        map: "battleon-1",
        name: "battleon",
        requireExactRoom: false,
        roomNumber: 1,
      });
      expect(yield* parseMapTarget("battleon-999")).toEqual({
        map: "battleon-999",
        name: "battleon",
        requireExactRoom: false,
        roomNumber: 999,
      });

      expect(yield* parseMapTarget("battleon-1000")).toEqual({
        map: "battleon-1000",
        name: "battleon",
        requireExactRoom: false,
        roomNumber: 1_000,
      });
      expect(yield* parseMapTarget("battleon-1001")).toEqual({
        map: "battleon-1001",
        name: "battleon",
        requireExactRoom: true,
        roomNumber: 1_001,
      });
      expect(yield* parseMapTarget("battleon-99999")).toEqual({
        map: "battleon-99999",
        name: "battleon",
        requireExactRoom: true,
        roomNumber: maximumRoom,
      });
      expect(yield* parseMapTarget("battleon-100000")).toEqual({
        map: "battleon-100000",
        name: "battleon",
        requireExactRoom: false,
        roomNumber: 100_000,
      });
    }),
  );

  it.effect("replaces invalid room suffixes with a private room", () =>
    Effect.gen(function* () {
      for (const map of ["battleon-private", "battleon-0", "battleon-1.5"]) {
        expect(yield* withRandomValue(parseMapTarget(map), 0)).toEqual({
          map: `battleon-${minimumRandomPrivateRoom}`,
          name: "battleon",
          requireExactRoom: true,
          roomNumber: minimumRandomPrivateRoom,
        });
      }
    }),
  );

  it.effect("generates private rooms across the inclusive range", () =>
    Effect.gen(function* () {
      expect(yield* withRandomValue(randomPrivateRoom, 0)).toBe(
        minimumRandomPrivateRoom,
      );
      expect(
        yield* withRandomValue(randomPrivateRoom, 1 - Number.EPSILON),
      ).toBe(maximumRoom);
    }),
  );

  it("preserves an explicit room when applying room policy", () => {
    expect(hasFixedRoom("battleon-1200")).toBe(true);
    expect(hasFixedRoom("battleon-100000")).toBe(true);
    expect(hasFixedRoom("battleon-private")).toBe(false);
    expect(withRoomNumber(" battleon ", 12_345)).toBe("battleon-12345");
    expect(withRoomNumber("battleon-1200", 12_345)).toBe("battleon-1200");
  });

  it.effect("shares room policy across map callers", () =>
    Effect.gen(function* () {
      expect(yield* applyRoomPolicy(" battleon ", PUBLIC_ROOM_POLICY)).toBe(
        " battleon ",
      );
      expect(
        yield* withRandomValue(
          applyRoomPolicy(" battleon ", RANDOM_PRIVATE_ROOM_POLICY),
          0,
        ),
      ).toBe(`battleon-${minimumRandomPrivateRoom}`);
      expect(
        yield* applyRoomPolicy("battleon", {
          kind: "specific",
          roomNumber: 1_001,
        }),
      ).toBe("battleon-1001");
      expect(
        yield* applyRoomPolicy("battleon", {
          kind: "specific",
          roomNumber: 42,
        }),
      ).toBe("battleon-42");
      expect(
        yield* applyRoomPolicy("battleon-1200", {
          kind: "specific",
          roomNumber: 1_001,
        }),
      ).toBe("battleon-1200");
      expect(
        yield* applyRoomPolicy("battleon-1200", RANDOM_PRIVATE_ROOM_POLICY),
      ).toBe("battleon-1200");

      expect(roomPolicyAcceptsRoom(PUBLIC_ROOM_POLICY, 1)).toBe(true);
      expect(
        roomPolicyAcceptsRoom(RANDOM_PRIVATE_ROOM_POLICY, minimumPrivateRoom),
      ).toBe(true);
      expect(roomPolicyAcceptsRoom(RANDOM_PRIVATE_ROOM_POLICY, 42)).toBe(false);
      expect(
        roomPolicyAcceptsRoom({ kind: "specific", roomNumber: 42 }, 42),
      ).toBe(true);
      expect(
        roomPolicyAcceptsRoom({ kind: "specific", roomNumber: 42 }, 43),
      ).toBe(false);

      expect(isPrivateRoom(minimumPrivateRoom)).toBe(true);
      expect(isPrivateRoom(maximumRoom)).toBe(true);
      expect(isPrivateRoom(minimumPrivateRoom - 1)).toBe(false);
      expect(isPrivateRoom(maximumRoom + 1)).toBe(false);
      expect(isRoomNumber(1)).toBe(true);
      expect(isRoomNumber(maximumRoom)).toBe(true);
      expect(isRoomNumber(0)).toBe(false);
      expect(isRoomNumber(maximumRoom + 1)).toBe(false);
    }),
  );
});
