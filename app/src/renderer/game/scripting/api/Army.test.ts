import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Ref } from "effect";

import type { ArmyApiRuntimeShape } from "../../army/Army";
import type {
  ArmyLoopTauntRuntimeAssignment,
  ArmyLoopTauntSkipContext,
} from "../../army/ArmyLoopTaunt";
import { makeScriptAsyncScope } from "../scriptAsyncScope";
import { makeScriptArmyApi } from "./Army";

const makeArmy = (
  stops: Ref.Ref<number>,
  captureFailure: (
    notify: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  ) => void = () => undefined,
  captureAssignments: (
    assignments: readonly ArmyLoopTauntRuntimeAssignment[],
  ) => void = () => undefined,
): ArmyApiRuntimeShape => {
  const startLoopTauntForScript: ArmyApiRuntimeShape["startLoopTauntForScript"] =
    (assignments, notifyFailure) =>
      Effect.sync(() => {
        captureFailure(notifyFailure);
        captureAssignments(assignments);
        let stopped = false;
        return {
          stop: () =>
            Effect.suspend(() => {
              if (stopped) return Effect.void;
              stopped = true;
              return Ref.update(stops, (count) => count + 1);
            }),
        };
      });

  return {
    startLoopTauntForScript,
  } as unknown as ArmyApiRuntimeShape;
};

describe("script Army API", () => {
  it.effect(
    "normalizes plain, Effect, and generator skip callbacks to trusted Effects",
    () =>
      Effect.gen(function* () {
        const stops = yield* Ref.make(0);
        const captured: ArmyLoopTauntRuntimeAssignment[] = [];
        const army = makeScriptArmyApi(
          makeArmy(stops, undefined, (assignments) => {
            captured.push(...assignments);
          }),
          makeScriptAsyncScope(),
          () => Effect.void,
        );
        const assignment = {
          players: [1],
          strategy: { type: "focus" as const },
          target: 1,
        };

        yield* army.startLoopTaunt([
          {
            ...assignment,
            skipWhen: () => true,
          },
          {
            ...assignment,
            skipWhen: () => Effect.succeed(false),
          },
          {
            ...assignment,
            skipWhen: function* () {
              yield* Effect.void;
              return true;
            },
          },
        ]);

        const context = {
          participants: [],
          self: { playerNumber: 1 },
        } as unknown as ArmyLoopTauntSkipContext;
        if (captured.some(({ skipWhen }) => skipWhen === undefined)) {
          return yield* Effect.die("skipWhen was not normalized");
        }
        const normalized = captured.map(({ skipWhen }) => skipWhen!(context));
        expect(normalized.every(Effect.isEffect)).toBe(true);
        expect(yield* Effect.all(normalized)).toEqual([true, false, true]);
      }),
  );

  it.effect("automatically stops Loop Taunt when the script scope closes", () =>
    Effect.gen(function* () {
      const stops = yield* Ref.make(0);
      const scope = makeScriptAsyncScope();
      const army = makeScriptArmyApi(makeArmy(stops), scope, () => Effect.void);

      const handle = yield* army.startLoopTaunt([]);
      yield* scope.close;
      yield* handle.stop();

      expect(yield* Ref.get(stops)).toBe(1);
    }),
  );

  it.effect("forwards a background failure into the script lifecycle", () =>
    Effect.gen(function* () {
      const stops = yield* Ref.make(0);
      const failures: Cause.Cause<unknown>[] = [];
      let notifyFailure:
        | ((cause: Cause.Cause<unknown>) => Effect.Effect<void>)
        | undefined;
      const scope = makeScriptAsyncScope();
      const army = makeScriptArmyApi(
        makeArmy(stops, (notify) => {
          notifyFailure = notify;
        }),
        scope,
        (cause) =>
          Effect.sync(() => {
            failures.push(cause);
          }),
      );

      yield* army.startLoopTaunt([]);
      if (notifyFailure === undefined) {
        return yield* Effect.die("Failure callback was not installed");
      }
      yield* notifyFailure(Cause.fail(new Error("degraded")));

      expect(failures).toHaveLength(1);
      expect(Cause.squash(failures[0]!)).toMatchObject({
        message: "degraded",
      });
      yield* scope.close;
    }),
  );

  it.effect(
    "immediately stops a handle acquired after scope cancellation",
    () =>
      Effect.gen(function* () {
        const stops = yield* Ref.make(0);
        const scope = makeScriptAsyncScope();
        yield* scope.close;
        const army = makeScriptArmyApi(
          makeArmy(stops),
          scope,
          () => Effect.void,
        );

        yield* army.startLoopTaunt([]);

        expect(yield* Ref.get(stops)).toBe(1);
      }),
  );
});
