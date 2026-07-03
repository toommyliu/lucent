import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeScriptAsyncScope } from "./scriptAsyncScope";

describe("scriptAsyncScope", () => {
  it.effect("runs cleanup immediately when registered after close", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const scope = makeScriptAsyncScope();

      yield* scope.close;
      yield* scope.addCleanup(() => {
        calls.push("late");
      });

      expect(calls).toEqual(["late"]);
    }),
  );
});
