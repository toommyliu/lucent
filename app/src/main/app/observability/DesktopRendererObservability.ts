import {
  app,
  ipcMain,
  type Event as ElectronEvent,
  type IpcMainEvent,
  type WebContents,
} from "electron";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Scope from "effect/Scope";
import * as Option from "effect/Option";

import { DiagnosticsIpc, GameConsoleIpc } from "../../../shared/ipc";
import {
  forkWebContentsScope,
  observeElectronEvent,
} from "../../electron/ElectronScope";
import { DesktopObservability } from "./DesktopObservability";

const decodeRendererRecord = Option.liftThrowable(
  DiagnosticsIpc.rendererRecord.decodePayload,
);
const decodeConsoleMessage = Option.liftThrowable(
  GameConsoleIpc.rendererMessage.decodePayload,
);

export const installDesktopRendererObservability = Effect.gen(function* () {
  const observability = yield* DesktopObservability;
  const installScope = yield* Effect.scope;
  const run = yield* FiberSet.makeRuntime<never, void>();

  const record = observability.recordUnsafe;

  const handleRendererRecord = (
    event: IpcMainEvent,
    ...payload: unknown[]
  ): void => {
    const decoded = decodeRendererRecord(payload[0]);
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
    ...payload: unknown[]
  ): void => {
    const decoded = decodeConsoleMessage(payload[0]);
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

  const observeWebContents = Effect.fn("observeWebContents")(function* (
    contents: WebContents,
  ) {
    const scope = yield* forkWebContentsScope(contents);
    const handleDidFailLoad = (
      _event: ElectronEvent,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean,
      _processId: number,
      _routingId: number,
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
    yield* observeElectronEvent(
      contents,
      "did-fail-load",
      handleDidFailLoad,
    ).pipe(Scope.provide(scope));
    yield* observeElectronEvent(contents, "responsive", handleResponsive).pipe(
      Scope.provide(scope),
    );
    yield* observeElectronEvent(
      contents,
      "unresponsive",
      handleUnresponsive,
    ).pipe(Scope.provide(scope));
  });

  const handleWebContentsCreated = (
    _event: ElectronEvent,
    contents: WebContents,
  ): void => {
    run(observeWebContents(contents).pipe(Scope.provide(installScope)));
  };

  yield* observeElectronEvent(
    ipcMain,
    DiagnosticsIpc.rendererRecord.channel,
    handleRendererRecord,
  );
  yield* observeElectronEvent(
    ipcMain,
    GameConsoleIpc.rendererMessage.channel,
    handleConsoleMessage,
  );
  yield* observeElectronEvent(
    app,
    "child-process-gone",
    handleChildProcessGone,
  );
  yield* observeElectronEvent(
    app,
    "render-process-gone",
    handleRenderProcessGone,
  );
  yield* observeElectronEvent(
    app,
    "web-contents-created",
    handleWebContentsCreated,
  );
});
