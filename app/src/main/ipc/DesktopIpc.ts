import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

import { Context, Effect, Layer, Schema } from "effect";

import { isElectronWindowUsable } from "../electron/windowUsability";
import {
  type IpcEventDescriptor,
  type IpcEventPayload,
  type IpcInvokeDescriptor,
  type IpcInvokePayload,
  type IpcInvokeResult,
} from "../../shared/ipc";
import { createDesktopIpcInvokeHandler } from "./DesktopIpcInvoke";

export interface DesktopIpcShape {
  readonly handle: <Descriptor extends IpcInvokeDescriptor<unknown, unknown>>(
    descriptor: Descriptor,
    handler: (
      payload: IpcInvokePayload<Descriptor>,
      event: IpcMainInvokeEvent,
    ) => Effect.Effect<IpcInvokeResult<Descriptor>, unknown, never>,
  ) => Effect.Effect<void>;
  readonly sendToAll: <Descriptor extends IpcEventDescriptor<unknown>>(
    descriptor: Descriptor,
    payload: IpcEventPayload<Descriptor>,
  ) => Effect.Effect<void>;
}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()(
  "lucent/desktop/ipc/DesktopIpc",
) {}

const sendToAll: DesktopIpcShape["sendToAll"] = (descriptor, payload) =>
  Schema.encodeUnknownEffect(descriptor.payload)(payload).pipe(
    Effect.flatMap((encoded) =>
      Effect.sync(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (isElectronWindowUsable(window)) {
            window.webContents.send(descriptor.channel, encoded);
          }
        }
      }),
    ),
    Effect.catch(() => Effect.void),
  );

const makeDesktopIpc = Effect.gen(function* () {
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const handle = <Descriptor extends IpcInvokeDescriptor<unknown, unknown>>(
    descriptor: Descriptor,
    handler: (
      payload: IpcInvokePayload<Descriptor>,
      event: IpcMainInvokeEvent,
    ) => Effect.Effect<IpcInvokeResult<Descriptor>, unknown, never>,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      ipcMain.removeHandler(descriptor.channel);
      ipcMain.handle(
        descriptor.channel,
        createDesktopIpcInvokeHandler(descriptor, handler, runPromise),
      );
    });

  return DesktopIpc.of({ handle, sendToAll });
});

export const layer = Layer.effect(DesktopIpc, makeDesktopIpc);
