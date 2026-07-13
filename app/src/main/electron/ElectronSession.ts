import { app, session, type Session } from "electron";

import { Context, Effect, Layer } from "effect";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import {
  getArtixLauncherRequestHeaders,
  getArtixLauncherUserAgent,
} from "../internal/ArtixLauncher";

export interface ElectronSessionShape {
  readonly prepareGameNetworking: Effect.Effect<void>;
}

export class ElectronSession extends Context.Service<
  ElectronSession,
  ElectronSessionShape
>()("lucent/desktop/electron/ElectronSession") {}

export const layer = Layer.effect(
  ElectronSession,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const gameRequestHeaders = getArtixLauncherRequestHeaders(env.platform);
    const gameUserAgent = getArtixLauncherUserAgent(env.platform);
    const configuredSessions = new Set<Session>();
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

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (sessionCreatedHookInstalled) {
          app.removeListener("session-created", configureSession);
          sessionCreatedHookInstalled = false;
        }
        for (const configuredSession of configuredSessions) {
          configuredSession.webRequest.onBeforeSendHeaders(null);
        }
        configuredSessions.clear();
      }),
    );

    return ElectronSession.of({ prepareGameNetworking });
  }),
);
