import { app, session, type Session } from "electron";
import { join } from "path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import {
  resolveFlashPreferenceTemplateRootPath,
  resolveFlashTrustRootPath,
} from "../flash/FlashPaths";
import {
  initializeAqwFlashPreferenceTemplate,
  seedAqwFlashPreferences,
} from "../flash/FlashPreferences";
import { writeTrustFile } from "../flash/FlashTrust";
import {
  getArtixLauncherRequestHeaders,
  getArtixLauncherUserAgent,
} from "../internal/ArtixLauncher";
import {
  activateManagedGamePartitionProfile,
  cleanupStaleGamePartitionProfiles,
  type GamePartitionOwner,
  makeGamePartitionRegistry,
  managedGamePartition,
  resolveGamePartitionProfilePath,
  retireManagedGamePartitionProfile,
} from "./ElectronGamePartitions";

export class ElectronGamePartitionError extends Schema.TaggedErrorClass<ElectronGamePartitionError>()(
  "ElectronGamePartitionError",
  {
    cause: Schema.Defect(),
    partition: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to prepare isolated game partition: ${this.partition}.`;
  }
}

export interface ElectronSessionShape {
  readonly acquireGamePartition: (
    owner: GamePartitionOwner,
  ) => Effect.Effect<string, ElectronGamePartitionError>;
  readonly prepareGameNetworking: Effect.Effect<void>;
  readonly releaseGamePartition: (partition: string) => void;
  readonly retireManagedGameProfile: (
    key: string,
  ) => Effect.Effect<void, ElectronGamePartitionError>;
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
    const gamePartitions = makeGamePartitionRegistry();
    const preferenceTemplateRootPath = resolveFlashPreferenceTemplateRootPath(
      env.appDataDir,
    );
    let sessionCreatedHookInstalled = false;

    yield* Effect.sync(() => {
      initializeAqwFlashPreferenceTemplate({
        sourceRootPaths: [resolveFlashTrustRootPath(env.appDataDir)],
        templateRootPath: preferenceTemplateRootPath,
      });
      cleanupStaleGamePartitionProfiles(env.appDataDir);
    }).pipe(Effect.catchCause(() => Effect.void));

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

    const acquireGamePartition: ElectronSessionShape["acquireGamePartition"] = (
      owner,
    ) =>
      Effect.suspend(() => {
        const partition = gamePartitions.acquire(owner);
        return Effect.try({
          try: () => {
            if (owner.kind === "managed-account") {
              activateManagedGamePartitionProfile(
                resolveGamePartitionProfilePath(
                  env.appDataDir,
                  managedGamePartition(owner.key),
                ),
              );
            }
            const profilePath = resolveGamePartitionProfilePath(
              env.appDataDir,
              partition,
            );
            const flashRootPath = resolveFlashTrustRootPath(profilePath);
            seedAqwFlashPreferences({
              targetRootPath: flashRootPath,
              templateRootPath: preferenceTemplateRootPath,
            });
            writeTrustFile({
              appName: "lucent",
              rootPath: flashRootPath,
              trustedPaths: [join(env.assetsDir, "loader.swf")],
            });
            configureSession(session.fromPartition(partition));
            return partition;
          },
          catch: (cause) =>
            new ElectronGamePartitionError({ cause, partition }),
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => gamePartitions.release(partition)),
          ),
        );
      });

    const retireManagedGameProfile: ElectronSessionShape["retireManagedGameProfile"] =
      (key) => {
        const partition = managedGamePartition(key);
        return Effect.try({
          try: () => {
            retireManagedGamePartitionProfile(env.appDataDir, key);
          },
          catch: (cause) =>
            new ElectronGamePartitionError({ cause, partition }),
        }).pipe(Effect.asVoid);
      };

    const releaseGamePartition = (partition: string): void =>
      gamePartitions.release(partition);

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

    return ElectronSession.of({
      acquireGamePartition,
      prepareGameNetworking,
      releaseGamePartition,
      retireManagedGameProfile,
    });
  }),
);
