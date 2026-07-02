import { describe, expect, it } from "@effect/vitest";
import { Data, Deferred, Effect, Layer, Option } from "effect";
import * as TestClock from "effect/testing/TestClock";

import { Jobs, layer as JobsLayer, type JobsShape } from "./Jobs";

class JobsTestError extends Data.TaggedError("JobsTestError")<{
  readonly message: string;
}> {}

const withJobs = <A>(
  body: (jobs: JobsShape) => Effect.Effect<A, unknown>,
  options?: { readonly testClock?: boolean },
): Effect.Effect<A, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const jobs = yield* Jobs;
      return yield* body(jobs);
    }),
  ).pipe(
    Effect.provide(
      options?.testClock === true
        ? Layer.mergeAll(JobsLayer, TestClock.layer())
        : JobsLayer,
    ),
  );

describe("Jobs", () => {
  it.effect("one-shot job starts and unregisters after completion", () =>
    withJobs((jobs) =>
      Effect.gen(function* () {
        const completed = yield* Deferred.make<void>();

        const started = yield* jobs.start(
          "once",
          Deferred.succeed(completed, undefined).pipe(Effect.asVoid),
        );
        yield* Deferred.await(completed);
        yield* Effect.yieldNow;

        expect(started).toBe(true);
        expect(yield* jobs.isRunning("once")).toBe(false);
        expect(yield* jobs.getRunningKeys).toEqual([]);
      }),
    ),
  );

  it.effect(
    "duplicate job with replace false does not replace existing job",
    () =>
      withJobs((jobs) =>
        Effect.gen(function* () {
          const firstInterrupted = yield* Deferred.make<void>();
          const secondStarted = yield* Deferred.make<void>();

          expect(
            yield* jobs.start(
              "same",
              Effect.never.pipe(
                Effect.onInterrupt(() =>
                  Deferred.succeed(firstInterrupted, undefined).pipe(
                    Effect.asVoid,
                  ),
                ),
              ),
            ),
          ).toBe(true);

          expect(
            yield* jobs.start(
              "same",
              Deferred.succeed(secondStarted, undefined).pipe(Effect.asVoid),
              { replace: false },
            ),
          ).toBe(false);

          yield* Effect.yieldNow;
          expect(Option.isNone(yield* Deferred.poll(firstInterrupted))).toBe(
            true,
          );
          expect(Option.isNone(yield* Deferred.poll(secondStarted))).toBe(true);
          expect(yield* jobs.isRunning("same")).toBe(true);
        }),
      ),
  );

  it.effect(
    "duplicate job with default replacement interrupts previous job",
    () =>
      withJobs(
        (jobs) =>
          Effect.gen(function* () {
            const firstStarted = yield* Deferred.make<void>();
            const firstInterrupted = yield* Deferred.make<void>();
            const secondStarted = yield* Deferred.make<void>();

            yield* jobs.start(
              "same",
              Deferred.succeed(firstStarted, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() =>
                  Deferred.succeed(firstInterrupted, undefined).pipe(
                    Effect.asVoid,
                  ),
                ),
              ),
            );
            yield* Deferred.await(firstStarted);

            expect(
              yield* jobs.start(
                "same",
                Deferred.succeed(secondStarted, undefined).pipe(
                  Effect.andThen(Effect.never),
                ),
              ),
            ).toBe(true);

            yield* Deferred.await(firstInterrupted);
            yield* Deferred.await(secondStarted);
            expect(yield* jobs.isRunning("same")).toBe(true);
          }),
        { testClock: true },
      ),
  );

  it.effect("stop interrupts a running job", () =>
    withJobs((jobs) =>
      Effect.gen(function* () {
        const interrupted = yield* Deferred.make<void>();

        yield* jobs.start(
          "running",
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
            ),
          ),
        );
        yield* Effect.yieldNow;

        expect(yield* jobs.stop("running")).toBe(true);
        yield* Deferred.await(interrupted);
        expect(yield* jobs.isRunning("running")).toBe(false);
      }),
    ),
  );

  it.effect("stopAll interrupts all running jobs", () =>
    withJobs((jobs) =>
      Effect.gen(function* () {
        const interruptedA = yield* Deferred.make<void>();
        const interruptedB = yield* Deferred.make<void>();

        yield* jobs.start(
          "a",
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Deferred.succeed(interruptedA, undefined).pipe(Effect.asVoid),
            ),
          ),
        );
        yield* jobs.start(
          "b",
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Deferred.succeed(interruptedB, undefined).pipe(Effect.asVoid),
            ),
          ),
        );
        yield* Effect.yieldNow;

        yield* jobs.stopAll;
        yield* Deferred.await(interruptedA);
        yield* Deferred.await(interruptedB);
        expect(yield* jobs.getRunningKeys).toEqual([]);
      }),
    ),
  );

  it.effect("periodic job respects runOnStart", () =>
    withJobs(
      (jobs) =>
        Effect.gen(function* () {
          let runs = 0;

          yield* jobs.startPeriodic(
            "periodic",
            "1 second",
            Effect.sync(() => {
              runs += 1;
            }),
            { runOnStart: false },
          );
          yield* Effect.yieldNow;
          expect(runs).toBe(0);

          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;
          expect(runs).toBe(1);
        }),
      { testClock: true },
    ),
  );

  it.effect("periodic job respects shouldRun", () =>
    withJobs(
      (jobs) =>
        Effect.gen(function* () {
          let allowed = false;
          let runs = 0;

          yield* jobs.startPeriodic(
            "periodic",
            "1 second",
            Effect.sync(() => {
              runs += 1;
            }),
            {
              runOnStart: true,
              shouldRun: Effect.sync(() => allowed),
            },
          );
          yield* Effect.yieldNow;
          expect(runs).toBe(0);

          allowed = true;
          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;
          expect(runs).toBe(1);

          allowed = false;
          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;
          expect(runs).toBe(1);
        }),
      { testClock: true },
    ),
  );

  it.effect("periodic cycle failure is swallowed while loop continues", () =>
    withJobs(
      (jobs) =>
        Effect.gen(function* () {
          let runs = 0;

          yield* jobs.startPeriodic(
            "flaky",
            "1 second",
            Effect.gen(function* () {
              runs += 1;
              if (runs === 1) {
                return yield* new JobsTestError({
                  message: "first cycle failed",
                });
              }
            }),
            { runOnStart: true },
          );

          yield* Effect.yieldNow;
          expect(runs).toBe(1);

          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;
          expect(runs).toBe(2);
          expect(yield* jobs.isRunning("flaky")).toBe(true);
        }),
      { testClock: true },
    ),
  );
});
