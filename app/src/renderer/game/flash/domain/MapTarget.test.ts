import { describe, expect, it } from "@effect/vitest";
import { Effect, Random } from "effect";

import {
  hasFixedRoom,
  maximumRoom,
  minimumPrivateRoom,
  parseMapTarget,
  privateRoom,
  randomPrivateRoom,
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
          map: `battleon-${minimumPrivateRoom}`,
          name: "battleon",
          requireExactRoom: true,
          roomNumber: minimumPrivateRoom,
        });
      }
    }),
  );

  it.effect("generates private rooms across the inclusive range", () =>
    Effect.gen(function* () {
      expect(yield* withRandomValue(randomPrivateRoom, 0)).toBe(
        minimumPrivateRoom,
      );
      expect(
        yield* withRandomValue(randomPrivateRoom, 1 - Number.EPSILON),
      ).toBe(maximumRoom);
    }),
  );

  it("preserves an explicit room when applying private-room policy", () => {
    expect(hasFixedRoom("battleon-1200")).toBe(true);
    expect(hasFixedRoom("battleon-100000")).toBe(true);
    expect(hasFixedRoom("battleon-private")).toBe(false);
    expect(privateRoom(" battleon ", 12_345)).toBe("battleon-12345");
    expect(privateRoom("battleon-1200", 12_345)).toBe("battleon-1200");
  });
});
