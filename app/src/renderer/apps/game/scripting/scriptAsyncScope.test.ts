import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeScriptAsyncScope } from "./scriptAsyncScope";

describe("scriptAsyncScope", () => {
  it.effect(
    "closes once in reverse order and runs late cleanup immediately",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const scope = makeScriptAsyncScope();

        yield* scope.addCleanup(() => {
          calls.push("first");
        });
        yield* scope.addCleanup(() =>
          Effect.sync(() => {
            calls.push("second");
          }),
        );
        yield* scope.addCleanup(() =>
          Effect.sync(() => {
            calls.push("failing");
          }).pipe(Effect.andThen(Effect.fail("cleanup failed"))),
        );

        expect(scope.signal.aborted).toBe(false);
        yield* scope.close;
        yield* scope.close;
        yield* scope.addCleanup(() => {
          calls.push("late");
        });

        expect(scope.signal.aborted).toBe(true);
        expect(calls).toEqual(["failing", "second", "first", "late"]);
      }),
  );
});
