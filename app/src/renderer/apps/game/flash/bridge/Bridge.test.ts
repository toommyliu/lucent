import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { WireBoolean } from "../contract/Coercion";
import { makeBridge } from "./Bridge";

const targetWith = (swf: Record<string, (...args: never[]) => unknown>) =>
  ({ swf }) as unknown as Pick<Window, "swf">;

describe("Bridge", () => {
  it.effect(
    "decodes wire values and returns none for invocation failures",
    () =>
      Effect.gen(function* () {
        const target = targetWith({
          "auth.isLoggedIn": () => "1",
          "auth.isTemporarilyKicked": () => false,
        });
        const bridge = yield* makeBridge(target);

        const loggedIn = yield* bridge.invoke(
          "auth.isLoggedIn",
          undefined,
          WireBoolean,
        );
        expect(Option.getOrNull(loggedIn)).toBe(true);

        const kicked = yield* bridge.invoke(
          "auth.isTemporarilyKicked",
          undefined,
          WireBoolean,
        );
        expect(Option.getOrNull(kicked)).toBe(false);

        const missing = yield* bridge.invoke(
          "auth.isLoggedIn",
          undefined,
          Schema.Boolean,
        );
        expect(Option.isNone(missing)).toBe(true);
        expect(
          Option.isNone(
            yield* bridge.invoke("auth.getServers", undefined, Schema.Boolean),
          ),
        ).toBe(true);
      }),
  );
});
