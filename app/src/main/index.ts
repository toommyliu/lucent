import { app } from "electron";
import * as Effect from "effect/Effect";

import { makeDesktopLayer } from "./app/Layers";
import { makeDesktopRuntime } from "./app/DesktopRuntime";
import { prepareMainProcess } from "./app/Preflight";

const bootstrap = prepareMainProcess();

void Effect.runPromise(
  makeDesktopRuntime(bootstrap.cliOptions).pipe(
    Effect.provide(makeDesktopLayer(bootstrap.envConfig)),
  ),
).catch((cause) => {
  console.error("Lucent desktop runtime failed to start.", cause);
  app.exit(1);
});
