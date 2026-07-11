import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option } from "effect";
import * as TestClock from "effect/testing/TestClock";

import { waitUntil, waitUntilSome } from "./Wait";

describe("Wait polling", () => {
  it.effect("checks immediately and polls until a value is available", () =>
    Effect.gen(function* () {
      let immediateChecks = 0;
      const immediate = yield* waitUntil(
        Effect.sync(() => {
          immediateChecks += 1;
          return true;
        }),
      );
      expect(immediate).toBe(true);
      expect(immediateChecks).toBe(1);

      let pollChecks = 0;
      const polled = yield* waitUntilSome(
        Effect.sync(() => {
          pollChecks += 1;
          return pollChecks === 3 ? Option.some("ready") : Option.none();
        }),
        { interval: 0 },
      );
      expect(polled).toBe("ready");
      expect(pollChecks).toBe(3);
    }),
  );

  it.effect("returns false or null when the timeout expires", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let untilChecks = 0;
        const untilInterrupted = yield* Deferred.make<void>();
        const untilFiber = yield* waitUntil(
          Effect.sync(() => {
            untilChecks += 1;
          }).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Deferred.succeed(untilInterrupted, undefined).pipe(Effect.asVoid),
            ),
          ),
          { interval: "1 second", timeout: "5 seconds" },
        ).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        expect(untilChecks).toBe(1);
        yield* TestClock.adjust("5 seconds");
        expect(yield* Fiber.join(untilFiber)).toBe(false);
        yield* Deferred.await(untilInterrupted);

        let untilSomeChecks = 0;
        const untilSomeInterrupted = yield* Deferred.make<void>();
        const untilSomeFiber = yield* waitUntilSome(
          Effect.sync(() => {
            untilSomeChecks += 1;
          }).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Deferred.succeed(untilSomeInterrupted, undefined).pipe(
                Effect.asVoid,
              ),
            ),
          ),
          {
            interval: "1 second",
            timeout: "5 seconds",
          },
        ).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("5 seconds");
        expect(yield* Fiber.join(untilSomeFiber)).toBeNull();
        yield* Deferred.await(untilSomeInterrupted);

        yield* TestClock.adjust("10 seconds");
        yield* Effect.yieldNow;
        expect(untilChecks).toBe(1);
        expect(untilSomeChecks).toBe(1);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
