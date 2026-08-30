import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ScriptBuiltinModules } from "./ScriptBuiltinModules";
import { compileScriptEval } from "./ScriptEvaluator";
import { scriptEffectStd } from "./ScriptEffectStd";
import { ScriptExecutionError } from "./ScriptRunnerErrors";

const modules = {
  effect: scriptEffectStd,
  "lucent/api": { environment: { marker: "environment" }, marker: "api" },
  "lucent/autorelogin": { marker: "auto-relogin" },
  "lucent/autozone": { marker: "auto-zone" },
  "lucent/filesystem": { marker: "filesystem" },
  "lucent/script": { marker: "script" },
} as unknown as ScriptBuiltinModules;

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
        `console.log(script.marker, autoRelogin.marker, autoZone.marker);
return yield* Effect.succeed([api.marker, api.environment.marker, filesystem.marker]);`,
        modules,
        debugConsole,
      );

      expect(result).toEqual(["api", "environment", "filesystem"]);
      expect(logs).toEqual([["script", "auto-relogin", "auto-zone"]]);
    }),
  );

  it.effect("reports syntax errors as script execution errors", () =>
    Effect.gen(function* () {
      const error = yield* compileScriptEval("return (", modules, console).pipe(
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
