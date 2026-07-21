import { Effect } from "effect";

import { WindowsIpc } from "../../../shared/ipc";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeDesktopIpcMethod } from "../DesktopIpc";

export const open = makeDesktopIpcMethod({
  descriptor: WindowsIpc.open,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.windows.open")(function* (payload, sender) {
    const windows = yield* DesktopWindows;
    return yield* windows.open(
      payload.kind,
      payload.kind === "environment"
        ? { ownerBrowserWindowId: sender.browserWindowId }
        : undefined,
    );
  }),
});

export const methods = [open] as const;
