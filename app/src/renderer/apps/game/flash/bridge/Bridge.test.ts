import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";

import { WireBoolean } from "../contract/Coercion";
import { Bridge, makeBridge } from "./Bridge";

const targetWith = (swf: Record<string, (...args: never[]) => unknown>) =>
  ({ swf }) as unknown as Pick<Window, "swf">;

describe("Bridge", () => {
  it.effect(
    "decodes wire values and returns none for invocation failures",
    () =>
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

          const missing = yield* bridge.invoke(
            "auth.isTemporarilyKicked",
            undefined,
            Schema.Boolean,
          );
          expect(Option.isNone(missing)).toBe(true);
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
