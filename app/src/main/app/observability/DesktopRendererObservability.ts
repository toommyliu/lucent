import {
  app,
  ipcMain,
  type Event as ElectronEvent,
  type IpcMainEvent,
  type WebContents,
} from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { DiagnosticsIpc, GameConsoleIpc } from "../../../shared/ipc";
import { DesktopObservability } from "./DesktopObservability";

const decodeRendererRecord = Option.liftThrowable(
  DiagnosticsIpc.rendererRecord.decodePayload,
);
const decodeConsoleMessage = Option.liftThrowable(
  GameConsoleIpc.rendererMessage.decodePayload,
);

export const installDesktopRendererObservability = Effect.gen(function* () {
  const observability = yield* DesktopObservability;
  const webContentsCleanups = new Set<() => void>();

  const record = observability.recordUnsafe;

  const handleRendererRecord = (
    event: IpcMainEvent,
    rawPayload: unknown,
  ): void => {
    const decoded = decodeRendererRecord(rawPayload);
    if (Option.isNone(decoded)) {
      return;
    }
    const { type, ...data } = decoded.value;
    record({
      component: "renderer",
      event: type,
      data: { rendererId: event.sender.id, ...data },
    });
  };

  const handleConsoleMessage = (
    event: IpcMainEvent,
    rawPayload: unknown,
  ): void => {
    const decoded = decodeConsoleMessage(rawPayload);
    if (Option.isNone(decoded)) {
      return;
    }
    record({
      component: "renderer",
      event: "console",
      data: { message: decoded.value.message, rendererId: event.sender.id },
    });
  };

  const handleChildProcessGone = (
    _event: ElectronEvent,
    details: Electron.Details,
  ): void => {
    record({
      component: "process",
      event: "child.gone",
      data: details,
    });
  };

  const handleRenderProcessGone = (
    _event: ElectronEvent,
    contents: WebContents,
    details: Electron.RenderProcessGoneDetails,
  ): void => {
    record({
      component: "renderer",
      event: "process.gone",
      data: { rendererId: contents.id, ...details },
    });
  };

  const observeWebContents = (contents: WebContents): void => {
    const handleDidFailLoad = (
      _event: ElectronEvent,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean,
    ): void => {
      record({
        component: "renderer",
        event: "load.failed",
        data: {
          errorCode,
          errorDescription,
          isMainFrame,
          rendererId: contents.id,
          validatedUrl,
        },
      });
    };
    const handleResponsive = (): void => {
      record({
        component: "renderer",
        event: "responsive",
        data: { rendererId: contents.id },
      });
    };
    const handleUnresponsive = (): void => {
      record({
        component: "renderer",
        event: "unresponsive",
        data: { rendererId: contents.id },
      });
    };
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      contents.removeListener("did-fail-load", handleDidFailLoad);
      contents.removeListener("responsive", handleResponsive);
      contents.removeListener("unresponsive", handleUnresponsive);
      contents.removeListener("destroyed", cleanup);
      webContentsCleanups.delete(cleanup);
    };

    contents.on("did-fail-load", handleDidFailLoad);
    contents.on("responsive", handleResponsive);
    contents.on("unresponsive", handleUnresponsive);
    contents.once("destroyed", cleanup);
    webContentsCleanups.add(cleanup);
  };

  const handleWebContentsCreated = (
    _event: ElectronEvent,
    contents: WebContents,
  ): void => {
    observeWebContents(contents);
  };

  yield* Effect.sync(() => {
    ipcMain.on(DiagnosticsIpc.rendererRecord.channel, handleRendererRecord);
    ipcMain.on(GameConsoleIpc.rendererMessage.channel, handleConsoleMessage);
    app.on("child-process-gone", handleChildProcessGone);
    app.on("render-process-gone", handleRenderProcessGone);
    app.on("web-contents-created", handleWebContentsCreated);
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      ipcMain.removeListener(
        DiagnosticsIpc.rendererRecord.channel,
        handleRendererRecord,
      );
      ipcMain.removeListener(
        GameConsoleIpc.rendererMessage.channel,
        handleConsoleMessage,
      );
      app.removeListener("child-process-gone", handleChildProcessGone);
      app.removeListener("render-process-gone", handleRenderProcessGone);
      app.removeListener("web-contents-created", handleWebContentsCreated);
      for (const cleanup of webContentsCleanups) {
        cleanup();
      }
    }),
  );
});
