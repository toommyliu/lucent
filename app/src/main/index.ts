import "../shared/polyfills";
import { app } from "electron";
import { Effect } from "effect";

import { makeDesktopLayer } from "./app/Layers";
import { makeDesktopRuntime } from "./app/DesktopRuntime";
import { prepareMainProcess } from "./app/Preflight";

const bootstrap = prepareMainProcess();

void Effect.runPromise(
  makeDesktopRuntime(bootstrap.cliOptions, bootstrap.flash).pipe(
    Effect.provide(makeDesktopLayer(bootstrap.envConfig)),
  ),
).catch(() => {
  app.exit(1);
});
