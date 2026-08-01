import * as Effect from "effect/Effect";

import { GameRendererIpc } from "../../../shared/ipc";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeDesktopIpcMethod } from "../DesktopIpc";

export const ready = makeDesktopIpcMethod({
  descriptor: GameRendererIpc.ready,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.gameRenderer.ready")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      yield* windows.markRendererReady(
        sender.browserWindowId,
        payload.generation,
      );
    },
  ),
});

export const getGeneration = makeDesktopIpcMethod({
  descriptor: GameRendererIpc.getGeneration,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.gameRenderer.getGeneration")(
    function* (_payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.getRendererGeneration(sender.browserWindowId);
    },
  ),
});

export const methods = [getGeneration, ready] as const;
