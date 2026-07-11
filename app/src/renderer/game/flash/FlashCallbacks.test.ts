import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

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
            const raw = "[Sending - STR]: %xt%zm%mv%123456%880%249%8%";
            let logged: string | null = null;
            const installed = window.packetFromClient;

            window.packetFromClient = (packet) => {
              logged = packet;
            };

            expect(window.packetFromClient).toBe(installed);
            window.packetFromClient?.(raw);

            const event = yield* callbacks.take();

            expect(logged).toBe(raw);
            expect(event).toEqual({ raw, type: "client-packet" });
          }).pipe(Effect.provide(FlashCallbacksLayer));
        }),
      ),
  );

  it.effect(
    "buffers every callback in invocation order before consumption",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* withTestWindow;
          yield* Effect.gen(function* () {
            const callbacks = yield* FlashCallbacks;
            const count = 1_100;

            for (let index = 0; index < count; index += 1) {
              window.packetFromServer?.(`packet-${index}`);
            }

            for (let index = 0; index < count; index += 1) {
              expect(yield* callbacks.take()).toEqual({
                raw: `packet-${index}`,
                type: "server-packet",
              });
            }
          }).pipe(Effect.provide(FlashCallbacksLayer));
        }),
      ),
  );

  it.effect("enqueues before invoking a re-entrant chained callback", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* withTestWindow;
        yield* Effect.gen(function* () {
          const callbacks = yield* FlashCallbacks;
          window.packetFromClient = () => {
            window.packetFromServer?.("nested");
          };

          window.packetFromClient?.("outer");

          expect(yield* callbacks.take()).toEqual({
            raw: "outer",
            type: "client-packet",
          });
          expect(yield* callbacks.take()).toEqual({
            raw: "nested",
            type: "server-packet",
          });
        }).pipe(Effect.provide(FlashCallbacksLayer));
      }),
    ),
  );

  it.effect("contains chained callback failures without losing the event", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* withTestWindow;
        const consoleError = vi
          .spyOn(console, "error")
          .mockImplementation(() => undefined);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            consoleError.mockRestore();
          }),
        );

        yield* Effect.gen(function* () {
          const callbacks = yield* FlashCallbacks;
          const failure = new Error("chained failure");
          window.packetFromClient = () => {
            throw failure;
          };

          expect(() =>
            window.packetFromClient?.("ordered-packet"),
          ).not.toThrow();
          expect(yield* callbacks.take()).toEqual({
            raw: "ordered-packet",
            type: "client-packet",
          });
          expect(consoleError).toHaveBeenCalledWith(
            "[flash callbacks] chained callback failed",
            expect.objectContaining({
              cause: failure,
              key: "packetFromClient",
            }),
          );
        }).pipe(Effect.provide(FlashCallbacksLayer));
      }),
    ),
  );
});
