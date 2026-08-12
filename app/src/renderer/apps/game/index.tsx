import { mountDesktopRenderer } from "../../RendererBootstrap";
import { App } from "./App";
import { flashRuntime } from "./flash";
import { installConsoleForwarder } from "./consoleForwarder";
import { installLoaderGrabberBridge } from "./loaderGrabberBridge";
import { installPacketsBridge } from "./packetsBridge";
import { selectDesktopBridge } from "../../../shared/desktopBridge";

const desktop = selectDesktopBridge(window.desktop, "game");

installConsoleForwarder(desktop.gameConsoleObservability);
const loaderGrabberBridge = installLoaderGrabberBridge(
  flashRuntime,
  desktop.loaderGrabber,
);
const packetsBridge = installPacketsBridge(flashRuntime, desktop.packets);
const gameRendererGeneration = desktop.gameRenderer.getGeneration();

void Promise.all([flashRuntime.context(), gameRendererGeneration])
  .then(([, generation]) => {
    performance.mark("lucent.game.flash-runtime-ready");
    return desktop.gameRenderer.ready(generation);
  })
  .then(() => {
    performance.mark("lucent.game.renderer-ready-reported");
  })
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
