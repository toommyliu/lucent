import "../../shared/polyfills";

import { render } from "solid-js/web";

import { installRendererThemeSync } from "../theme";
import { App, markGameLoaded, setGameLoadProgress } from "./App";
import {
  disposeFlashRuntime,
  keepFlashRuntimeAlive,
} from "./flash/FlashRuntime";

const themeSync = installRendererThemeSync();
const root = document.getElementById("root");
let disposeRender: (() => void) | undefined;

// window.onDebug = (message: string): void => {
//   console.debug("[flash]", message);
// };

window.onProgress = (percent: number): void => {
  setGameLoadProgress(percent);
};

window.onLoaded = (): void => {
  markGameLoaded();
};

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

keepFlashRuntimeAlive();
setGameLoadProgress(0);

window.addEventListener(
  "beforeunload",
  () => {
    disposeRender?.();
    disposeFlashRuntime();
    themeSync.dispose();
  },
  { once: true },
);
