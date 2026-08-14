import type { IpcMainInvokeEvent, WebContents } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { DesktopRendererKind } from "../window/DesktopWindowCatalog";
import { DesktopWindows } from "../window/DesktopWindows";

export interface DesktopIpcSender {
  readonly browserWindowId: number;
  readonly kind: DesktopRendererKind;
}

export type DesktopIpcSenderKinds = readonly [
  DesktopRendererKind,
  ...DesktopRendererKind[],
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
  readonly getWebContentsId: (webContents: WebContents) => number;
}

export const makeDesktopIpcSenders = (
  windows: DesktopWindows["Service"],
  options: DesktopIpcSendersOptions = {
    getWebContentsId: (webContents) => webContents.id,
  },
): DesktopIpcSenders["Service"] => {
  const requireSender = Effect.fn("DesktopIpcSenders.require")(function* (
    event: IpcMainInvokeEvent,
    allowedKinds: DesktopIpcSenderKinds,
  ) {
    const browserWindowId = options.getWebContentsId(event.sender);
    const kind = yield* windows.getBrowserWindowKind(browserWindowId).pipe(
      Effect.mapError(
        () =>
          new DesktopIpcSenderError({
            detail: `Failed to resolve IPC sender window: ${browserWindowId}`,
          }),
      ),
    );
    if (kind === null || !allowedKinds.includes(kind)) {
      return yield* new DesktopIpcSenderError({
        detail: `IPC sender must be one of: ${allowedKinds.join(", ")}`,
      });
    }

    return {
      browserWindowId,
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
