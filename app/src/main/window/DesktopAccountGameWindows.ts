import { Effect, Layer } from "effect";

import { AccountGameWindows } from "../internal/accounts/AccountGameWindows";
import { DesktopWindows } from "./DesktopWindows";

export const layer = Layer.effect(
  AccountGameWindows,
  Effect.gen(function* () {
    const windows = yield* DesktopWindows;

    const close: AccountGameWindows["Service"]["close"] = (gameWindowId) =>
      windows.closeBrowserWindow(gameWindowId);

    const onClosed: AccountGameWindows["Service"]["onClosed"] = (listener) =>
      windows.onClosed((event) =>
        event.kind === "game" ? listener(event.browserWindowId) : Effect.void,
      );

    const open: AccountGameWindows["Service"]["open"] = (options) =>
      Effect.gen(function* () {
        let gameWindowId: number | undefined;
        const instanceId = yield* windows.open("game", {
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

    return AccountGameWindows.of({
      close,
      onClosed,
      open,
      reveal,
    });
  }),
);
