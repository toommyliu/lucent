import { app, session, type Session } from "electron";

import { Context, Effect, Layer } from "effect";

import { DesktopEnvironment } from "../app/DesktopEnvironment";

export interface ElectronSessionShape {
  readonly prepareGameNetworking: Effect.Effect<void>;
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

export const layer = Layer.effect(
  ElectronSession,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const gameRequestHeaders = getGameRequestHeaders(env.platform);
    const gameUserAgent = getArtixLauncherUserAgent(env.platform);
    const configuredSessions = new WeakSet<Session>();
    let sessionCreatedHookInstalled = false;

    const configureSession = (targetSession: Session): void => {
      if (configuredSessions.has(targetSession)) {
        return;
      }

      configuredSessions.add(targetSession);
      targetSession.setUserAgent(gameUserAgent);
      targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const requestHeaders = { ...details.requestHeaders };
        for (const [name, value] of Object.entries(gameRequestHeaders)) {
          requestHeaders[name] = value;
        }

        callback({ cancel: false, requestHeaders });
      });
    };

    const prepareGameNetworking = Effect.sync(() => {
      configureSession(session.defaultSession);
      if (sessionCreatedHookInstalled) {
        return;
      }

      sessionCreatedHookInstalled = true;
      app.on("session-created", configureSession);
    });

    return ElectronSession.of({ prepareGameNetworking });
  }),
);
