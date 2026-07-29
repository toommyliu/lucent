import { describe, expect, it } from "@effect/vitest";
import { createEmptyEnvironmentState } from "@lucent/core/environment";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import {
  makeEnvironmentDropAutomation,
  type PendingEnvironmentDrop,
} from "./dropAutomation";

const drop = (itemId: number, name: string): PendingEnvironmentDrop => ({
  coins: false,
  itemId,
  memberOnly: false,
  name,
});

const rejectionState = {
  ...createEmptyEnvironmentState(),
  itemRules: { buckets: [], rejectElse: true },
};

interface DropAction {
  readonly action: "accept" | "reject";
  readonly attempt: number;
  readonly itemId: number;
}

const makeHarness = Effect.fn("EnvironmentDropAutomation.test.makeHarness")(
  function* (
    initialDrops: readonly PendingEnvironmentDrop[],
    rejectResult: (itemId: number, attempt: number) => boolean = () => true,
  ): Effect.fn.Return<
    {
      readonly actions: readonly DropAction[];
      readonly addDrop: (item: PendingEnvironmentDrop) => Effect.Effect<void>;
      readonly getReconciliationCount: Effect.Effect<number>;
      readonly nextAction: Effect.Effect<DropAction>;
      readonly requestReconciliation: Effect.Effect<void>;
    },
    never,
    Scope.Scope
  > {
    const drops = yield* Ref.make(initialDrops);
    const reconciliationCount = yield* Ref.make(0);
    const actionQueue = yield* Queue.unbounded<DropAction>();
    const actions: DropAction[] = [];
    const attempts = new Map<number, number>();

    const removeDrop = (itemId: number) =>
      Ref.update(drops, (current) =>
        current.filter((item) => item.itemId !== itemId),
      );
    const recordAction = (action: "accept" | "reject", itemId: number) =>
      Effect.gen(function* () {
        const attempt = (attempts.get(itemId) ?? 0) + 1;
        attempts.set(itemId, attempt);
        const event = { action, attempt, itemId } as const;
        actions.push(event);
        yield* Queue.offer(actionQueue, event);
        return attempt;
      });

    const automation = yield* makeEnvironmentDropAutomation({
      accept: (itemId) =>
        recordAction("accept", itemId).pipe(
          Effect.andThen(removeDrop(itemId)),
          Effect.as(true),
        ),
      contains: (itemId) =>
        Ref.get(drops).pipe(
          Effect.map((current) =>
            current.some((item) => item.itemId === itemId),
          ),
        ),
      getAll: () =>
        Ref.updateAndGet(reconciliationCount, (count) => count + 1).pipe(
          Effect.andThen(Ref.get(drops)),
        ),
      getState: () => Effect.succeed(rejectionState),
      reject: (itemId) =>
        recordAction("reject", itemId).pipe(
          Effect.flatMap((attempt) => {
            const rejected = rejectResult(itemId, attempt);
            return rejected
              ? removeDrop(itemId).pipe(Effect.as(true))
              : Effect.succeed(false);
          }),
        ),
      reportFailure: () => Effect.void,
    });

    return {
      actions,
      addDrop: (item) => Ref.update(drops, (current) => [...current, item]),
      getReconciliationCount: Ref.get(reconciliationCount),
      nextAction: Queue.take(actionQueue),
      requestReconciliation: automation.requestReconciliation,
    };
  },
);

const yieldToWorker = Effect.yieldNow.pipe(Effect.andThen(Effect.yieldNow));

describe("Environment drop automation", () => {
  it.effect("reconciles the complete pending list on one wake-up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness([
          drop(1, "Old A"),
          drop(2, "Old B"),
          drop(3, "New C"),
        ]);

        yield* harness.requestReconciliation;
        const actions = yield* Effect.all(
          [harness.nextAction, harness.nextAction, harness.nextAction],
          { concurrency: "unbounded" },
        );

        expect(actions.map(({ itemId }) => itemId).toSorted()).toEqual([
          1, 2, 3,
        ]);
        expect(yield* harness.getReconciliationCount).toBe(1);
      }),
    ),
  );

  it.effect(
    "makes one immediate rejection attempt and three backoff retries",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness([drop(1, "A")], () => false);

          yield* harness.requestReconciliation;
          expect(yield* harness.nextAction).toMatchObject({ attempt: 1 });
          yield* yieldToWorker;

          yield* TestClock.adjust("99 millis");
          expect(harness.actions).toHaveLength(1);
          yield* TestClock.adjust("1 millis");
          expect(yield* harness.nextAction).toMatchObject({ attempt: 2 });
          yield* yieldToWorker;

          yield* TestClock.adjust("199 millis");
          expect(harness.actions).toHaveLength(2);
          yield* TestClock.adjust("1 millis");
          expect(yield* harness.nextAction).toMatchObject({ attempt: 3 });
          yield* yieldToWorker;

          yield* TestClock.adjust("399 millis");
          expect(harness.actions).toHaveLength(3);
          yield* TestClock.adjust("1 millis");
          expect(yield* harness.nextAction).toMatchObject({ attempt: 4 });
          yield* yieldToWorker;

          yield* TestClock.adjust("1 second");
          expect(harness.actions).toHaveLength(4);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("does not hold the mutation semaphore during retry backoff", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness(
          [drop(1, "A"), drop(2, "B")],
          (itemId) => itemId === 2,
        );

        yield* harness.requestReconciliation;
        const actions = yield* Effect.all(
          [harness.nextAction, harness.nextAction],
          { concurrency: "unbounded" },
        );

        expect(actions).toEqual([
          { action: "reject", attempt: 1, itemId: 1 },
          { action: "reject", attempt: 1, itemId: 2 },
        ]);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("coalesces events during backoff into one follow-up rescan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness(
          [drop(1, "A")],
          (_itemId, attempt) => attempt > 4,
        );

        yield* harness.requestReconciliation;
        expect(yield* harness.nextAction).toMatchObject({
          attempt: 1,
          itemId: 1,
        });
        yield* yieldToWorker;
        yield* harness.addDrop(drop(2, "C"));
        yield* Effect.all(
          [
            harness.requestReconciliation,
            harness.requestReconciliation,
            harness.requestReconciliation,
          ],
          { concurrency: "unbounded" },
        );

        yield* TestClock.adjust("100 millis");
        expect(yield* harness.nextAction).toMatchObject({
          attempt: 2,
          itemId: 1,
        });
        yield* yieldToWorker;
        yield* TestClock.adjust("200 millis");
        expect(yield* harness.nextAction).toMatchObject({
          attempt: 3,
          itemId: 1,
        });
        yield* yieldToWorker;
        yield* TestClock.adjust("400 millis");
        expect(yield* harness.nextAction).toMatchObject({
          attempt: 4,
          itemId: 1,
        });

        const followUp = yield* Effect.all(
          [harness.nextAction, harness.nextAction],
          { concurrency: "unbounded" },
        );
        expect(followUp.map(({ itemId }) => itemId).toSorted()).toEqual([1, 2]);
        yield* yieldToWorker;
        expect(yield* harness.getReconciliationCount).toBe(2);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
