import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { ArmyApi } from "../army/Army";
import { Automation } from "../automation/Automation";
import { Environment } from "../environment/Environment";
import { Api } from "../flash/api/Api";
import { Bridge } from "../flash/bridge/Bridge";
import type { ScriptBuiltinModules } from "./ScriptBuiltinModules";
import { makeScriptBuiltinModules } from "./ScriptBuiltinModules";
import { ScriptRunner } from "./ScriptRunner";
import {
  makeScriptRuntimeApi,
  runScriptExitActions,
  snapshotRoomPolicy,
  snapshotScriptRuntimeOptions,
  type ScriptRuntimeOptionsUpdate,
} from "./ScriptRuntime";
import { makeScriptAsyncScope } from "./scriptAsyncScope";
import {
  getScriptExitRequest,
  ScriptExecutionError,
  ScriptStopSignal,
} from "./ScriptRunnerErrors";
import { makeScriptStartReadiness } from "./ScriptStartReadiness";
import { makeScriptRuntimeServices } from "./api/Services";

const ScriptEvalFunction = Function as unknown as new (
  ...args: string[]
) => (
  api: ScriptBuiltinModules["lucent/api"],
  script: ScriptBuiltinModules["lucent/script"],
  autoRelogin: ScriptBuiltinModules["lucent/autorelogin"],
  autoZone: ScriptBuiltinModules["lucent/autozone"],
  effect: ScriptBuiltinModules["effect"]["Effect"],
  console: Console,
) => Effect.Effect<unknown, unknown, never>;

const compileErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "Script evaluation could not be compiled.";

export const compileScriptEval = (
  source: string,
  modules: ScriptBuiltinModules,
  debugConsole: Console,
): Effect.Effect<unknown, unknown> =>
  Effect.try({
    try: () => {
      const evaluate = new ScriptEvalFunction(
        "api",
        "script",
        "autoRelogin",
        "autoZone",
        "Effect",
        "console",
        `"use strict";
return Effect.gen(function* debugScriptEval() {
${source}
});
//# sourceURL=lucent-script-eval://scratch`,
      );
      return evaluate(
        modules["lucent/api"],
        modules["lucent/script"],
        modules["lucent/autorelogin"],
        modules["lucent/autozone"],
        modules.effect.Effect,
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
    const environment = yield* Environment;
    const bridge = yield* Bridge;
    const runner = yield* ScriptRunner;
    const scope = makeScriptAsyncScope();

    return yield* Effect.gen(function* () {
      const callbackFailure = yield* Deferred.make<never, unknown>();
      const disposeConnectionWatcher = yield* api.events.on(
        { type: "connection" },
        (event) =>
          event.status === "OnConnectionLost" ||
          event.status === "OnConnectionFailed"
            ? Deferred.fail(
                callbackFailure,
                new ScriptStopSignal({ reason: "Connection lost" }),
              ).pipe(Effect.asVoid)
            : Effect.void,
      );
      yield* scope.addCleanup(disposeConnectionWatcher);
      const readiness = makeScriptStartReadiness({
        auth: api.auth,
        player: api.player,
        projectionReadiness: api.projectionReadiness,
        wait: api.wait,
      });
      yield* Effect.raceFirst(
        readiness.awaitReady(),
        Deferred.await(callbackFailure),
      );

      const runnerOptions = yield* runner.getOptions();
      const optionsRef = yield* Ref.make(
        snapshotScriptRuntimeOptions(runnerOptions),
      );
      const getOptions = () =>
        Ref.get(optionsRef).pipe(Effect.map(snapshotScriptRuntimeOptions));
      const setOptions = (update: ScriptRuntimeOptionsUpdate) =>
        Ref.updateAndGet(optionsRef, (options) =>
          snapshotScriptRuntimeOptions(update(options)),
        ).pipe(Effect.map(snapshotScriptRuntimeOptions));
      const script = makeScriptRuntimeApi({
        getOptions,
        inputValues: {},
        log: (message) => debugConsole.log("[script]", message),
        scope,
        setOptions,
      });
      const modules = makeScriptBuiltinModules({
        autoRelogin: automation.autoRelogin,
        autoZone: automation.autoZone,
        bridge,
        failCause: (cause: Cause.Cause<unknown>) =>
          Deferred.failCause(callbackFailure, cause).pipe(Effect.asVoid),
        roomPolicy: Ref.get(optionsRef).pipe(
          Effect.map((options) => snapshotRoomPolicy(options.roomPolicy)),
        ),
        scope,
        script,
        services: makeScriptRuntimeServices(api, army, environment),
      });

      return yield* Effect.raceFirst(
        compileScriptEval(source, modules, debugConsole),
        Deferred.await(callbackFailure),
      ).pipe(
        Effect.catch((error) =>
          error instanceof ScriptStopSignal
            ? runScriptExitActions(getScriptExitRequest(error), {
                closeWindow: () => window.close(),
                logout: api.auth.logout,
              }).pipe(Effect.andThen(Effect.fail(error)))
            : Effect.fail(error),
        ),
      );
    }).pipe(Effect.ensuring(scope.close));
  },
);
