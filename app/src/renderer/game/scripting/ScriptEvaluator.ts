import { Cause, Deferred, Effect, Ref } from "effect";

import { ArmyApi } from "../army/Army";
import { Automation } from "../automation/Automation";
import { Api } from "../flash/api/Api";
import { Bridge } from "../flash/bridge/Bridge";
import type {
  ScriptEffectStd,
  ScriptLucentStd,
  ScriptRuntimeOptions,
} from "./ScriptApi";
import { scriptEffectStd } from "./ScriptEffectStd";
import { ScriptRunner } from "./ScriptRunner";
import {
  makeScriptRuntimeApi,
  snapshotScriptRuntimeOptions,
} from "./ScriptRuntime";
import { makeScriptLucentStd } from "./ScriptRuntimeStd";
import { makeScriptAsyncScope } from "./scriptAsyncScope";
import { ScriptExecutionError } from "./ScriptRunnerErrors";
import { makeScriptRuntimeServices } from "./api/Services";

const ScriptEvalFunction = Function as unknown as new (
  ...args: string[]
) => (
  script: ScriptLucentStd["script"],
  features: ScriptLucentStd["features"],
  api: ScriptLucentStd["api"],
  effect: ScriptEffectStd["Effect"],
  console: Console,
) => Effect.Effect<unknown, unknown, never>;

const compileErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "Script evaluation could not be compiled.";

export const compileScriptEval = (
  source: string,
  lucent: ScriptLucentStd,
  debugConsole: Console,
): Effect.Effect<unknown, unknown> =>
  Effect.try({
    try: () => {
      const evaluate = new ScriptEvalFunction(
        "script",
        "features",
        "api",
        "Effect",
        "console",
        `"use strict";
return Effect.gen(function* debugScriptEval() {
${source}
});
//# sourceURL=lucent-script-eval://scratch`,
      );
      return evaluate(
        lucent.script,
        lucent.features,
        lucent.api,
        scriptEffectStd.Effect,
        debugConsole,
      );
    },
    catch: (cause) =>
      new ScriptExecutionError({
        cause,
        detail: compileErrorMessage(cause),
      }),
  }).pipe(Effect.flatten);

export const runScriptEval = Effect.fn("ScriptEvaluator.runScriptEval")(
  function* (source: string, debugConsole: Console) {
    const api = yield* Api;
    const army = yield* ArmyApi;
    const automation = yield* Automation;
    const bridge = yield* Bridge;
    const runner = yield* ScriptRunner;
    const scope = makeScriptAsyncScope();

    return yield* Effect.gen(function* () {
      const optionsRef = yield* Ref.make<ScriptRuntimeOptions>(
        yield* runner.getOptions(),
      );
      const getOptions = () =>
        Ref.get(optionsRef).pipe(Effect.map(snapshotScriptRuntimeOptions));
      const setOptions = (
        update: (options: ScriptRuntimeOptions) => ScriptRuntimeOptions,
      ) =>
        Ref.updateAndGet(optionsRef, (options) =>
          snapshotScriptRuntimeOptions(update(options)),
        ).pipe(Effect.map(snapshotScriptRuntimeOptions));
      const callbackFailure = yield* Deferred.make<never, unknown>();
      const script = makeScriptRuntimeApi({
        auth: api.auth,
        getOptions,
        inputValues: {},
        log: (message) => debugConsole.log("[script]", message),
        scope,
        setOptions,
      });
      const lucent = makeScriptLucentStd({
        bridge,
        failCause: (cause: Cause.Cause<unknown>) =>
          Deferred.failCause(callbackFailure, cause).pipe(Effect.asVoid),
        features: {
          autoRelogin: automation.autoRelogin,
          autoZone: automation.autoZone,
        },
        scope,
        script,
        services: makeScriptRuntimeServices(api, army),
      });

      return yield* Effect.raceFirst(
        compileScriptEval(source, lucent, debugConsole),
        Deferred.await(callbackFailure),
      );
    }).pipe(Effect.ensuring(scope.close));
  },
);
