import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { FlashProtocol } from "./protocol/FlashProtocol";
import { FlashLiveLayer } from "./runtime";

describe("FlashLiveLayer", () => {
  it.effect("starts and disposes callback wiring with scope cleanup", () =>
    Effect.gen(function* () {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
      const fakeWindow: Record<string, unknown> = {};
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: fakeWindow,
      });

      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* FlashProtocol;
            expect(typeof fakeWindow["onLoaded"]).toBe("function");
            expect(typeof fakeWindow["packetFromServer"]).toBe("function");
          }).pipe(Effect.provide(FlashLiveLayer)),
        );

        expect(fakeWindow["onLoaded"]).toBeUndefined();
        expect(fakeWindow["packetFromServer"]).toBeUndefined();
      } finally {
        if (descriptor === undefined) {
          Reflect.deleteProperty(globalThis, "window");
        } else {
          Object.defineProperty(globalThis, "window", descriptor);
        }
      }
    }),
  );
});
