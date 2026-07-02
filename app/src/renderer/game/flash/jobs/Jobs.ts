import {
  Cause,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Ref,
  SynchronizedRef,
} from "effect";
import type { Duration } from "effect";

export interface JobStartOptions {
  readonly replace?: boolean;
}

export interface PeriodicJobStartOptions extends JobStartOptions {
  readonly runOnStart?: boolean;
  readonly shouldRun?: Effect.Effect<boolean>;
}

export interface PeriodicJobDefinition extends PeriodicJobStartOptions {
  readonly key: string;
  readonly interval: Duration.Input;
  readonly task: Effect.Effect<void, unknown>;
}

export interface JobsShape {
  readonly start: (
    key: string,
    task: Effect.Effect<void, unknown>,
    options?: JobStartOptions,
  ) => Effect.Effect<boolean>;
  readonly startPeriodic: (
    key: string,
    interval: Duration.Input,
    task: Effect.Effect<void, unknown>,
    options?: PeriodicJobStartOptions,
  ) => Effect.Effect<boolean>;
  readonly startPeriodicJob: (
    definition: PeriodicJobDefinition,
  ) => Effect.Effect<boolean>;
  readonly stop: (key: string) => Effect.Effect<boolean>;
  readonly stopAll: Effect.Effect<void>;
  readonly isRunning: (key: string) => Effect.Effect<boolean>;
  readonly getRunningKeys: Effect.Effect<readonly string[]>;
}

export class Jobs extends Context.Service<Jobs, JobsShape>()(
  "lucent/game/flash/jobs/Jobs",
) {}

type JobToken = number;

interface JobEntry {
  readonly fiber: Fiber.Fiber<void, unknown>;
  readonly token: JobToken;
}

interface StartResult {
  readonly release: boolean;
  readonly started: boolean;
  readonly previous: Fiber.Fiber<void, unknown> | undefined;
}

const nextToken = (value: number): number => Math.max(0, value) + 1;

const canRun = (key: string, shouldRun: Effect.Effect<boolean> | undefined) =>
  (shouldRun ?? Effect.succeed(true)).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning({
        cause,
        key,
        message: "periodic job gate failed",
      }).pipe(Effect.as(false)),
    ),
  );

export const layer = Layer.effect(
  Jobs,
  Effect.gen(function* () {
    const activeJobs = yield* SynchronizedRef.make<Map<string, JobEntry>>(
      new Map(),
    );
    const nextJobToken = yield* Ref.make<JobToken>(0);

    const removeIfCurrent = (key: string, token: JobToken) =>
      SynchronizedRef.update(activeJobs, (jobs) => {
        const current = jobs.get(key);
        if (current?.token !== token) {
          return jobs;
        }

        const nextJobs = new Map(jobs);
        nextJobs.delete(key);
        return nextJobs;
      });

    const stop: JobsShape["stop"] = (key) =>
      Effect.gen(function* () {
        const previous = yield* SynchronizedRef.modify(activeJobs, (jobs) => {
          const current = jobs.get(key);
          if (current === undefined) {
            return [undefined, jobs] as const;
          }

          const nextJobs = new Map(jobs);
          nextJobs.delete(key);
          return [current.fiber, nextJobs] as const;
        });

        if (previous === undefined) {
          return false;
        }

        yield* Fiber.interrupt(previous);
        return true;
      });

    const stopAll = Effect.gen(function* () {
      const fibers = yield* SynchronizedRef.modify(activeJobs, (jobs) => {
        const current = Array.from(jobs.values(), (entry) => entry.fiber);
        return [current, new Map<string, JobEntry>()] as const;
      });

      yield* Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), {
        discard: true,
      });
    });

    yield* Effect.addFinalizer(() => stopAll);

    const startInternal = (
      key: string,
      task: Effect.Effect<void, unknown>,
      replace: boolean,
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const token = yield* Ref.updateAndGet(nextJobToken, nextToken);
        const release = yield* Deferred.make<void>();
        const fiber = yield* Deferred.await(release).pipe(
          Effect.andThen(task),
          Effect.ensuring(removeIfCurrent(key, token)),
          Effect.forkDetach,
        );

        const result = yield* SynchronizedRef.modify(
          activeJobs,
          (jobs): readonly [StartResult, Map<string, JobEntry>] => {
            const current = jobs.get(key);
            if (current !== undefined && !replace) {
              return [
                {
                  previous: undefined,
                  release: false,
                  started: false,
                },
                jobs,
              ];
            }

            const nextJobs = new Map(jobs);
            nextJobs.set(key, { fiber, token });
            return [
              {
                previous: current?.fiber,
                release: true,
                started: true,
              },
              nextJobs,
            ];
          },
        );

        if (!result.started) {
          yield* Fiber.interrupt(fiber);
          return false;
        }

        if (result.previous !== undefined) {
          yield* Fiber.interrupt(result.previous);
        }

        if (result.release) {
          yield* Deferred.succeed(release, undefined);
        }

        return true;
      });

    const start: JobsShape["start"] = (key, task, options) =>
      startInternal(
        key,
        task.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logError({
                  cause,
                  key,
                  message: "job failed",
                }).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
        ),
        options?.replace ?? true,
      );

    const runPeriodic = (
      key: string,
      interval: Duration.Input,
      task: Effect.Effect<void, unknown>,
      options?: PeriodicJobStartOptions,
    ) => {
      const runOnStart = options?.runOnStart ?? true;

      const runCycle = task.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logError({
                cause,
                key,
                message: "periodic job cycle failed",
              }),
        ),
      );

      const loop = Effect.gen(function* () {
        if (runOnStart && (yield* canRun(key, options?.shouldRun))) {
          yield* runCycle;
        }

        while (true) {
          yield* Effect.sleep(interval);

          if (!(yield* canRun(key, options?.shouldRun))) {
            continue;
          }

          yield* runCycle;
        }
      });

      return startInternal(key, loop, options?.replace ?? true);
    };

    const startPeriodic: JobsShape["startPeriodic"] = (
      key,
      interval,
      task,
      options,
    ) => runPeriodic(key, interval, task, options);

    const startPeriodicJob: JobsShape["startPeriodicJob"] = (definition) =>
      runPeriodic(
        definition.key,
        definition.interval,
        definition.task,
        definition,
      );

    return Jobs.of({
      getRunningKeys: SynchronizedRef.get(activeJobs).pipe(
        Effect.map((jobs) => Array.from(jobs.keys()).sort()),
      ),
      isRunning: (key) =>
        SynchronizedRef.get(activeJobs).pipe(
          Effect.map((jobs) => jobs.has(key)),
        ),
      start,
      startPeriodic,
      startPeriodicJob,
      stop,
      stopAll,
    });
  }),
);
