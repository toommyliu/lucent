import { mountDesktopRenderer } from "../RendererBootstrap";
import { App } from "./App";
import { flashRuntime } from "./flash";

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

mountDesktopRenderer((props) => <App {...props} />, {
  cleanup: () => {
    void flashRuntime.dispose();
  },
  markReady: false,
});
