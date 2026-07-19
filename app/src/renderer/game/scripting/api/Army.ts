import type { Cause } from "effect";
import { Effect } from "effect";

import type { ArmyApiRuntimeShape, ArmyApiShape } from "../../army/Army";
import {
  ArmyLoopTauntError,
  type ArmyLoopTauntAssignment,
  type ArmyLoopTauntRuntimeAssignment,
} from "../../army/ArmyLoopTaunt";
import { ScriptExecutionError } from "../ScriptRunnerErrors";
import type { ScriptAsyncScope } from "../scriptAsyncScope";
import { normalizeScriptCallbackResult } from "./Callbacks";

const normalizeSkipWhen =
  (
    skipWhen: NonNullable<ArmyLoopTauntAssignment["skipWhen"]>,
  ): NonNullable<ArmyLoopTauntRuntimeAssignment["skipWhen"]> =>
  (context) =>
    Effect.try({
      try: () => skipWhen(context),
      catch: (cause) =>
        new ScriptExecutionError({
          cause,
          detail: "Loop Taunt skipWhen callback threw.",
        }),
    }).pipe(
      Effect.flatMap((result) =>
        typeof result === "boolean"
          ? Effect.succeed(result)
          : normalizeScriptCallbackResult(result),
      ),
      Effect.flatMap((result) =>
        typeof result === "boolean"
          ? Effect.succeed(result)
          : Effect.fail(
              new ScriptExecutionError({
                detail:
                  "Loop Taunt skipWhen must return a boolean, an Effect<boolean>, or a generator that returns a boolean.",
              }),
            ),
      ),
    );

export const makeScriptArmyApi = (
  army: ArmyApiRuntimeShape,
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ArmyApiShape => {
  const { startLoopTauntForScript, ...publicArmy } = army;

  return {
    ...publicArmy,
    startLoopTaunt: (assignments) =>
      Effect.try({
        try: () =>
          assignments.map((assignment): ArmyLoopTauntRuntimeAssignment => {
            if (assignment.skipWhen === undefined) {
              return {
                players: assignment.players,
                strategy: assignment.strategy,
                target: assignment.target,
              };
            }
            if (typeof assignment.skipWhen !== "function") {
              throw new ArmyLoopTauntError(
                "Loop Taunt skipWhen must be a function",
              );
            }
            return {
              ...assignment,
              skipWhen: normalizeSkipWhen(assignment.skipWhen),
            };
          }),
        catch: (cause) =>
          cause instanceof ArmyLoopTauntError
            ? cause
            : new ArmyLoopTauntError(
                "Failed to normalize Loop Taunt assignments",
                cause,
              ),
      }).pipe(
        Effect.flatMap((normalized) =>
          startLoopTauntForScript(normalized, failCause),
        ),
        Effect.tap((handle) => scope.addCleanup(handle.stop)),
      ),
  };
};
