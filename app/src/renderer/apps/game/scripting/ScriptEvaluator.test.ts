import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ScriptLucentStd } from "./ScriptApi";
import { compileScriptEval } from "./ScriptEvaluator";
import { ScriptExecutionError } from "./ScriptRunnerErrors";

const lucent = {
  api: { environment: { marker: "environment" }, marker: "api" },
  features: { marker: "features" },
  script: { marker: "script" },
} as unknown as ScriptLucentStd;

describe("ScriptEvaluator", () => {
  it.effect("evaluates snippets with the scripting globals", () =>
    Effect.gen(function* () {
      const logs: unknown[][] = [];
      const debugConsole = {
        log: (...args: unknown[]) => {
          logs.push(args);
        },
      } as unknown as Console;
      const result = yield* compileScriptEval(
        `console.log(script.marker, features.marker);
return yield* Effect.succeed([api.marker, api.environment.marker]);`,
        lucent,
        debugConsole,
      );

      expect(result).toEqual(["api", "environment"]);
      expect(logs).toEqual([["script", "features"]]);
    }),
  );

  it.effect("reports syntax errors as script execution errors", () =>
    Effect.gen(function* () {
      const error = yield* compileScriptEval("return (", lucent, console).pipe(
        Effect.flip,
      );

      expect(error).toBeInstanceOf(ScriptExecutionError);
      if (!(error instanceof ScriptExecutionError)) {
        return;
      }
      expect(error.message).not.toBe(
        "Script evaluation could not be compiled.",
      );
    }),
  );
});
