import { Effect, Stream } from "effect";

import { mountDesktopRenderer } from "../RendererBootstrap";
import { App } from "./App";
import { flashRuntime } from "./flash";
import { Gateway } from "./flash/bridge/Gateway";
import { installGameConsoleForwarder } from "./gameConsoleForwarder";

installGameConsoleForwarder(window.desktop.gameConsoleObservability);

void flashRuntime.context().catch((cause) => {
  console.warn("[flash] runtime initialization failed", cause);
});

flashRuntime.runFork(
  Effect.gen(function* () {
    const gateway = yield* Gateway;
    yield* gateway.diagnostics.pipe(
      Stream.runForEach((diagnostic) =>
        Effect.sync(() => {
          console.warn("[flash:diagnostic]", diagnostic);
        }),
      ),
    );
  }),
);

mountDesktopRenderer((props) => <App {...props} />, {
  cleanup: () => {
    void flashRuntime.dispose();
  },
  markReady: false,
});
