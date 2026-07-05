import "../../shared/polyfills";

import { render } from "solid-js/web";
import { App } from "./App";
import { installRendererThemeSync } from "../theme";
import { flashRuntime } from "./flash";

const themeSync = installRendererThemeSync();
const root = document.getElementById("root");
let disposeRender: (() => void) | undefined;

window.onDebug = (message: string): void => {
  console.debug("[flash:debug]", message);
};

window.onExtensionResponse = (message: string): void => {
  console.log("[flash:onExtensionResponse]", message);
};

window.packetFromClient = (message: string): void => {
  console.log("[flash:packetFromClient]", message);
};

void flashRuntime.context().catch((cause) => {
  console.warn("[flash] runtime initialization failed", cause);
});

if (root !== null) {
  disposeRender = render(
    () => (
      <App
        initialSettings={window.desktop.settings.initial}
        platform={window.desktop.platform.os}
      />
    ),
    root,
  );
}

window.addEventListener(
  "beforeunload",
  () => {
    void flashRuntime.dispose();
    disposeRender?.();
    themeSync.dispose();
  },
  { once: true },
);
