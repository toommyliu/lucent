import { Effect } from "effect";

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
    const ownerBrowserWindowId =
      definition.scope !== "game-child"
        ? undefined
        : sender.kind === "game"
          ? sender.browserWindowId
          : yield* windows.getOwnerBrowserWindowId(sender.browserWindowId).pipe(
              Effect.flatMap((ownerBrowserWindowId) =>
                ownerBrowserWindowId === null
                  ? new DesktopWindowError({
                      detail: "Game child window has no owning game.",
                      id: String(sender.browserWindowId),
                    })
                  : Effect.succeed(ownerBrowserWindowId),
              ),
            );

    return yield* windows.open(
      payload.kind,
      ownerBrowserWindowId === undefined ? undefined : { ownerBrowserWindowId },
    );
  }),
});

export const methods = [open] as const;
