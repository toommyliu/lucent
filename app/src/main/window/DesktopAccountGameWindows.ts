import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AccountGameWindows } from "../internal/accounts/AccountGameWindows";
import { DesktopWindows } from "./DesktopWindows";

export const layer = Layer.effect(
  AccountGameWindows,
  Effect.gen(function* () {
    const windows = yield* DesktopWindows;

    const close: AccountGameWindows["Service"]["close"] = (gameWindowId) =>
      windows.closeBrowserWindow(gameWindowId);

    const getGroupId: AccountGameWindows["Service"]["getGroupId"] = (
      gameWindowId,
    ) => windows.getBrowserWindowGroupId(gameWindowId);

    const onClosed: AccountGameWindows["Service"]["onClosed"] = (listener) =>
      windows.onClosed((event) =>
        event.kind === "game" ? listener(event.browserWindowId) : Effect.void,
      );

    const open: AccountGameWindows["Service"]["open"] = (options) =>
      Effect.gen(function* () {
        let gameWindowId: number | undefined;
        const instanceId = yield* windows.open("game", {
          reuseGameHost: true,
          ...(options?.managedProfileKey === undefined
            ? {}
            : { managedGameProfileKey: options.managedProfileKey }),
          ...(options?.name === undefined
            ? {}
            : { gameViewName: options.name }),
          ...(options?.tile === undefined ? {} : { tile: options.tile }),
          ...(options?.onCreated === undefined
            ? {}
            : {
                onCreated: ({ browserWindowId }) => {
                  gameWindowId = browserWindowId;
                  return options.onCreated!(browserWindowId);
                },
              }),
        });
        return gameWindowId ?? (yield* windows.getBrowserWindowId(instanceId));
      });

    const reveal: AccountGameWindows["Service"]["reveal"] = (gameWindowId) =>
      windows.revealBrowserWindow(gameWindowId);

    const retireProfile: AccountGameWindows["Service"]["retireProfile"] =
      windows.retireManagedGameProfile;

    const setName: AccountGameWindows["Service"]["setName"] = (
      gameWindowId,
      name,
    ) => windows.setGameViewName(gameWindowId, name);

    return AccountGameWindows.of({
      close,
      getGroupId,
      onClosed,
      open,
      reveal,
      retireProfile,
      setName,
    });
  }),
);
