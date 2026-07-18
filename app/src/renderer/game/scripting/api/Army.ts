import type { Cause } from "effect";
import { Effect } from "effect";

import type { ArmyApiRuntimeShape, ArmyApiShape } from "../../army/Army";
import type { ScriptAsyncScope } from "../scriptAsyncScope";

export const makeScriptArmyApi = (
  army: ArmyApiRuntimeShape,
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ArmyApiShape => {
  const { startLoopTauntForScript, ...publicArmy } = army;

  return {
    ...publicArmy,
    startLoopTaunt: (assignments) =>
      startLoopTauntForScript(assignments, failCause).pipe(
        Effect.tap((handle) => scope.addCleanup(handle.stop)),
      ),
  };
};
