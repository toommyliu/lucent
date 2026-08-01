import { mountDesktopRenderer } from "../../RendererBootstrap";
import { App } from "./App";
import { flashRuntime } from "./flash";
import { installConsoleForwarder } from "./consoleForwarder";
import { installLoaderGrabberBridge } from "./loaderGrabberBridge";
import { installPacketsBridge } from "./packetsBridge";

installConsoleForwarder(window.desktop.gameConsoleObservability);
const loaderGrabberBridge = installLoaderGrabberBridge(flashRuntime);
const packetsBridge = installPacketsBridge(flashRuntime);
const gameRendererGeneration =
  window.desktop.gameRenderer?.getGeneration() ?? Promise.resolve(null);

void Promise.all([flashRuntime.context(), gameRendererGeneration])
  .then(([, generation]) =>
    generation === null
      ? undefined
      : window.desktop.gameRenderer?.ready(generation),
  )
  .catch((cause) => {
    console.warn("[flash] runtime initialization failed", cause);
  });

mountDesktopRenderer((props) => <App {...props} />, {
  cleanup: () => {
    loaderGrabberBridge.dispose();
    packetsBridge.dispose();
    void flashRuntime.dispose();
  },
  markReady: false,
});
