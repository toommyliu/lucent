import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { Context, Effect, Layer, Schema } from "effect";

import type { DesktopWindowKind } from "../window/DesktopWindowCatalog";
import { DesktopWindows } from "../window/DesktopWindows";

export interface DesktopIpcSender {
  readonly browserWindow: BrowserWindow;
  readonly browserWindowId: number;
  readonly kind: DesktopWindowKind;
}

export type DesktopIpcSenderKinds = readonly [
  DesktopWindowKind,
  ...DesktopWindowKind[],
];

export class DesktopIpcSenderError extends Schema.TaggedErrorClass<DesktopIpcSenderError>()(
  "DesktopIpcSenderError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DesktopIpcSendersShape {
  readonly require: (
    event: IpcMainInvokeEvent,
    allowedKinds: DesktopIpcSenderKinds,
  ) => Effect.Effect<DesktopIpcSender, DesktopIpcSenderError>;
}

export class DesktopIpcSenders extends Context.Service<
  DesktopIpcSenders,
  DesktopIpcSendersShape
>()("lucent/desktop/ipc/DesktopIpcSenders") {}

export interface DesktopIpcSendersOptions {
  readonly fromWebContents: (webContents: WebContents) => BrowserWindow | null;
}

export const makeDesktopIpcSenders = (
  windows: DesktopWindows["Service"],
  options: DesktopIpcSendersOptions = {
    fromWebContents: (webContents) =>
      BrowserWindow.fromWebContents(webContents),
  },
): DesktopIpcSenders["Service"] => {
  const requireSender = Effect.fn("DesktopIpcSenders.require")(function* (
    event: IpcMainInvokeEvent,
    allowedKinds: DesktopIpcSenderKinds,
  ) {
    const browserWindow = options.fromWebContents(event.sender);
    if (browserWindow === null) {
      return yield* new DesktopIpcSenderError({
        detail: "IPC sender is not attached to a BrowserWindow.",
      });
    }

    const kind = yield* windows.getBrowserWindowKind(browserWindow.id).pipe(
      Effect.mapError(
        () =>
          new DesktopIpcSenderError({
            detail: `Failed to resolve IPC sender window: ${browserWindow.id}`,
          }),
      ),
    );
    if (kind === null || !allowedKinds.includes(kind)) {
      return yield* new DesktopIpcSenderError({
        detail: `IPC sender must be one of: ${allowedKinds.join(", ")}`,
      });
    }

    return {
      browserWindow,
      browserWindowId: browserWindow.id,
      kind,
    };
  });

  return DesktopIpcSenders.of({
    require: requireSender,
  });
};

export const layer = Layer.effect(
  DesktopIpcSenders,
  Effect.gen(function* () {
    const windows = yield* DesktopWindows;
    return makeDesktopIpcSenders(windows);
  }),
);
