import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, PubSub } from "effect";

import { FlashCallbacks, layer as FlashCallbacksLayer } from "./FlashCallbacks";

const withTestWindow = Effect.acquireRelease(
  Effect.sync(() => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
      writable: true,
    });
    return original;
  }),
  (original) =>
    Effect.sync(() => {
      if (original === undefined) {
        delete (globalThis as Record<string, unknown>)["window"];
      } else {
        Object.defineProperty(globalThis, "window", original);
      }
    }),
);

describe("FlashCallbacks", () => {
  it.effect(
    "keeps publishing when a window callback is assigned after install",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* withTestWindow;
          yield* Effect.gen(function* () {
            const callbacks = yield* FlashCallbacks;
            const subscription = yield* callbacks.subscribe();
            const raw = "[Sending - STR]: %xt%zm%mv%123456%880%249%8%";
            let logged: string | null = null;
            const installed = window.packetFromClient;

            window.packetFromClient = (packet) => {
              logged = packet;
            };

            expect(window.packetFromClient).toBe(installed);
            window.packetFromClient?.(raw);

            const event = yield* PubSub.take(subscription).pipe(
              Effect.timeoutOption("1 second"),
            );

            expect(logged).toBe(raw);
            expect(Option.isSome(event)).toBe(true);
            if (Option.isSome(event)) {
              expect(event.value).toEqual({ raw, type: "client-packet" });
            }
          }).pipe(Effect.provide(FlashCallbacksLayer));
        }),
      ),
  );
});
