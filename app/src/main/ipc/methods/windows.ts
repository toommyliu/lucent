import * as Effect from "effect/Effect";

import { WindowsIpc } from "../../../shared/ipc";
import { getDesktopWindowDefinition } from "../../window/DesktopWindowCatalog";
import {
  DesktopWindowError,
  DesktopWindows,
} from "../../window/DesktopWindows";
import { makeDesktopIpcMethod } from "../DesktopIpc";

export const open = makeDesktopIpcMethod({
  descriptor: WindowsIpc.open,
  allowedSenders: ["game", "follower"],
  handler: Effect.fn("desktop.ipc.windows.open")(function* (payload, sender) {
    const windows = yield* DesktopWindows;
    if (sender.kind === "follower" && payload.kind !== "combat-profiles") {
      return yield* new DesktopWindowError({
        detail: "Follower windows may only open combat profiles.",
        id: payload.kind,
      });
    }

    const definition = getDesktopWindowDefinition(payload.kind);
    const ownerRendererId =
      definition.scope !== "game-child"
        ? undefined
        : sender.kind === "game"
          ? sender.rendererId
          : yield* windows.getOwnerRendererId(sender.rendererId).pipe(
              Effect.flatMap((ownerRendererId) =>
                ownerRendererId === null
                  ? new DesktopWindowError({
                      detail: "Game child window has no owning game.",
                      id: String(sender.rendererId),
                    })
                  : Effect.succeed(ownerRendererId),
              ),
            );

    return yield* windows.open(
      payload.kind,
      ownerRendererId === undefined ? undefined : { ownerRendererId },
    );
  }),
});

export const methods = [open] as const;
