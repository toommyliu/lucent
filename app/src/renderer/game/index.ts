import "../../shared/polyfills";

import { installRendererThemeSync } from "../theme";

const documentElement = document.documentElement;
const statusLabel = document.getElementById("status-label");
const statusProgress = document.getElementById("status-progress");
const themeSync = installRendererThemeSync();

const setStatus = (label: string, progress?: number): void => {
  if (statusLabel !== null) {
    statusLabel.textContent = label;
  }

  if (statusProgress !== null && progress !== undefined) {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    statusProgress.textContent = `${clamped}%`;
  }
};

window.onDebug = (message: string): void => {
  console.debug("[flash]", message);
};

window.onProgress = (percent: number): void => {
  setStatus("Loading AQW", percent);
};

window.onLoaded = (): void => {
  documentElement.dataset["loaded"] = "true";
  setStatus("AQW loaded", 100);
};

window.onConnection = (status: string): void => {
  console.debug("[flash:connection]", status);
};

window.onExtensionResponse = (packet: string): void => {
  console.debug("[flash:extension]", packet);
};

window.packetFromClient = (packet: string): void => {
  console.debug("[flash:client]", packet);
};

window.packetFromServer = (packet: string): void => {
  console.debug("[flash:server]", packet);
};

setStatus("Loading AQW", 0);

window.addEventListener(
  "beforeunload",
  () => {
    themeSync.dispose();
  },
  { once: true },
);
