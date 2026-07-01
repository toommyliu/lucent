import "../../shared/polyfills";

import { render } from "solid-js/web";
import { App } from "./App";
import { installRendererThemeSync } from "../theme";
import { flashRuntime } from "./flash";

const themeSync = installRendererThemeSync();
const root = document.getElementById("root");
let disposeRender: (() => void) | undefined;

void flashRuntime.context().catch((cause) => {
  console.warn("[flash] runtime initialization failed", cause);
});

// window.onDebug = (message: string): void => {
//   console.debug("[flash]", message);
// };

window.onProgress = (_percent: number): void => {};

window.onLoaded = (): void => {};

// window.packetFromClient = (packet: string): void => {
//   console.debug("[flash:client]", packet);
// };

// window.packetFromServer = (packet: string): void => {
//   console.debug("[flash:server]", packet);
// };

// window.onExtensionResponse = (packet: string): void => {
//   console.debug("[flash:extension]", packet);
// };

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
