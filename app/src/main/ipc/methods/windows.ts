import { Effect } from "effect";

import { WindowsIpc } from "../../../shared/ipc";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeDesktopIpcMethod } from "../DesktopIpc";

export const open = makeDesktopIpcMethod({
  descriptor: WindowsIpc.open,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.windows.open")(function* (payload) {
    const windows = yield* DesktopWindows;
    return yield* windows.open(payload.kind);
  }),
});

export const methods = [open] as const;
