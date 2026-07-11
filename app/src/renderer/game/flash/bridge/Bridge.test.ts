import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Schema, Stream } from "effect";

import { WireBoolean } from "../contract/Coercion";
import { Bridge, makeBridge } from "./Bridge";

const targetWith = (swf: Record<string, (...args: never[]) => unknown>) =>
  ({ swf }) as unknown as Pick<Window, "swf">;

describe("Bridge", () => {
  it.effect("decodes wire values and reports invocation failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = targetWith({
          "auth.isLoggedIn": () => "1",
        });
        const bridge = yield* makeBridge(target);

        const loggedIn = yield* bridge.invoke(
          "auth.isLoggedIn",
          undefined,
          WireBoolean,
        );
        expect(Option.getOrNull(loggedIn)).toBe(true);

        const diagnosticFiber = yield* bridge.diagnostics.pipe(
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const missing = yield* bridge.invoke(
          "auth.isTemporarilyKicked",
          undefined,
          Schema.Boolean,
        );
        expect(Option.isNone(missing)).toBe(true);

        const diagnostic = yield* Fiber.join(diagnosticFiber);
        expect(Option.getOrNull(diagnostic)?.operation).toBe(
          "auth.isTemporarilyKicked",
        );
      }),
    ),
  );

  it.effect("can be installed as a service layer", () =>
    Effect.gen(function* () {
      const bridge = yield* Bridge;
      const value = yield* bridge.invoke(
        "auth.isLoggedIn",
        undefined,
        Schema.Boolean,
      );
      expect(Option.getOrNull(value)).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.effect(
          Bridge,
          makeBridge(targetWith({ "auth.isLoggedIn": () => false })),
        ),
      ),
    ),
  );
});
