import { session } from "electron";

import { Context, Effect, Layer } from "effect";

export interface ElectronSessionShape {
  readonly installGameRequestHeaders: (input: {
    readonly platform: NodeJS.Platform;
    readonly webContentsId: number;
  }) => Effect.Effect<void>;
}

export class ElectronSession extends Context.Service<
  ElectronSession,
  ElectronSessionShape
>()("lucent/desktop/electron/ElectronSession") {}

const getArtixLauncherUserAgent = (platform: NodeJS.Platform): string => {
  if (platform === "darwin") {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_16_0) AppleWebKit/537.36 (KHTML, like Gecko) ArtixGameLauncher/2.2.0 Chrome/80.0.3987.163 Electron/8.5.5 Safari/537.36";
  }

  if (platform === "linux") {
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ArtixGameLauncher/2.2.0 Chrome/80.0.3987.163 Electron/8.5.5 Safari/537.36";
  }

  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ArtixGameLauncher/2.2.0 Chrome/80.0.3987.163 Electron/8.5.5 Safari/537.36";
};

const getGameRequestHeaders = (
  platform: NodeJS.Platform,
): Record<string, string> => ({
  "User-Agent": getArtixLauncherUserAgent(platform),
  "X-Requested-With": "ShockwaveFlash/32.0.0.371",
  artixmode: "launcher",
});

export const layer = Layer.succeed(
  ElectronSession,
  ElectronSession.of({
    installGameRequestHeaders: (input) =>
      Effect.sync(() => {
        session.defaultSession.webRequest.onBeforeSendHeaders(
          (details, callback) => {
            const requestHeaders = details.requestHeaders;
            if (details.webContentsId === input.webContentsId) {
              for (const [name, value] of Object.entries(
                getGameRequestHeaders(input.platform),
              )) {
                requestHeaders[name] = value;
              }
            }

            callback({ cancel: false, requestHeaders });
          },
        );
      }),
  }),
);
