import "abort-controller/polyfill";
import "core-js/stable";
import { app } from "electron";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Cause, Effect } from "effect";
import { makeProgram } from "./app/DesktopApp";
import { DesktopObservability } from "./app/DesktopObservability";
import { makeMainLayer } from "./app/layers";
import { prepareMainProcess } from "./app/preflight";

const bootstrap = prepareMainProcess();

makeProgram(bootstrap.earlyFlashSetup, bootstrap.cliOptions).pipe(
  Effect.catchCause((cause) =>
    Effect.gen(function* () {
      const observability = yield* DesktopObservability;
      yield* observability.error(
        "startup",
        "Main process failed",
        Cause.pretty(cause),
      );
      app.quit();
      return yield* Effect.failCause(cause);
    }),
  ),
  Effect.provide(makeMainLayer(bootstrap.envConfig)),
  NodeRuntime.runMain,
);
