import "../shared/generated/polyfills.node";
import { app } from "electron";
import * as Effect from "effect/Effect";

import { makeDesktopLayer } from "./app/Layers";
import { makeDesktopRuntime } from "./app/DesktopRuntime";
import { prepareMainProcess } from "./app/Preflight";

const bootstrap = prepareMainProcess();

void Effect.runPromise(
  makeDesktopRuntime(bootstrap.cliOptions, bootstrap.flash).pipe(
    Effect.provide(makeDesktopLayer(bootstrap.envConfig)),
  ),
).catch((cause) => {
  console.error("Lucent desktop runtime failed to start.", cause);
  app.exit(1);
});
