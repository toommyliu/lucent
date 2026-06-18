import { app } from "electron";
import { Effect, Layer } from "effect";
import {
  configureGameWindow,
  getLatestAppearanceSnapshot,
  getLatestSettingsSnapshot,
  observeRendererWindow,
} from "./DesktopApp";
import {
  DesktopEnvironment,
  DesktopEnvironmentLive,
  type DesktopEnvironmentConfig,
} from "./DesktopEnvironment";
import { DesktopLifecycleLive } from "./DesktopLifecycle";
import {
  DesktopObservability,
  DesktopObservabilityLive,
} from "./DesktopObservability";
import * as AccountSessions from "../backend/accounts/AccountSessions";
import * as AccountManagerRepository from "../backend/accounts/AccountRepository";
import * as ArmyConfigRepository from "../backend/army/ArmyConfigRepository";
import * as ArmyCoordinator from "../backend/army/ArmyCoordinator";
import * as CombatProfileRepository from "../backend/combat-profiles/CombatProfileRepository";
import * as EnvironmentStateStore from "../backend/environment/EnvironmentStateStore";
import * as FastTravelRepository from "../backend/fast-travels/FastTravelRepository";
import * as FollowerStateStore from "../backend/follower/FollowerStateStore";
import * as ScriptInputRepository from "../backend/scripting/ScriptInputRepository";
import * as ScriptLibrary from "../backend/scripting/ScriptLibrary";
import { FlashTrustLive } from "../flash/FlashTrust";
import { DesktopIpcLive } from "../ipc/DesktopIpc";
import {
  DesktopSettings,
  DesktopSettingsLive,
} from "../settings/DesktopSettings";
import { DesktopStorage, DesktopStorageLive } from "../storage/DesktopStorage";
import {
  makeUpdateCacheStore,
  makeUpdateChecker,
  UpdateChecker,
  updateCacheFileName,
} from "../updates/Updates";
import {
  getRendererGameWindowPath,
  getRendererWindowPath,
  WindowEnvironmentService,
  WindowLifecycleHooks,
  WindowOperationError,
  WindowServiceLive,
  WindowSnapshotService,
} from "../window/WindowService";
import * as GameWindowClient from "../window/GameWindowClient";

export const makeMainLayer = (envConfig: DesktopEnvironmentConfig) => {
  const environmentLayer = DesktopEnvironmentLive(envConfig);
  const baseLayer = Layer.mergeAll(environmentLayer, DesktopStorageLive);
  const flashTrustLayer = FlashTrustLive;
  const observabilityLayer = DesktopObservabilityLive.pipe(
    Layer.provideMerge(baseLayer),
  );
  const settingsLayer = DesktopSettingsLive.pipe(
    Layer.provideMerge(observabilityLayer),
  );
  const documentsLayer = Layer.mergeAll(
    AccountManagerRepository.layer,
    ArmyConfigRepository.layer,
    CombatProfileRepository.layer,
    FastTravelRepository.layer,
    ScriptInputRepository.layer,
    ScriptLibrary.layer,
  ).pipe(Layer.provideMerge(observabilityLayer));
  const windowEnvironmentLayer = Layer.effect(
    WindowEnvironmentService,
    Effect.gen(function* () {
      const env = yield* DesktopEnvironment;
      return {
        appIconPath: env.appIconPath,
        gameWindowHtmlPath: getRendererGameWindowPath(envConfig.rendererDir),
        isDev: envConfig.isDev,
        platform: process.platform,
        preloadPath: envConfig.preloadPath,
        windowHtmlPath: (id) =>
          getRendererWindowPath(envConfig.rendererDir, id),
      };
    }),
  ).pipe(Layer.provideMerge(environmentLayer));
  const windowSnapshotLayer = Layer.succeed(WindowSnapshotService, {
    getSettingsSnapshot: Effect.try({
      try: getLatestSettingsSnapshot,
      catch: (cause) =>
        new WindowOperationError({
          message: "Failed to read latest settings snapshot",
          cause,
        }),
    }),
    getAppearanceSnapshot: (settings) =>
      Effect.try({
        try: () => getLatestAppearanceSnapshot(settings),
        catch: (cause) =>
          new WindowOperationError({
            message: "Failed to create latest appearance snapshot",
            cause,
          }),
      }),
  });
  const windowLifecycleHooksLayer = Layer.effect(
    WindowLifecycleHooks,
    Effect.gen(function* () {
      const observability = yield* DesktopObservability;
      return {
        quitApp: Effect.sync(() => {
          app.quit();
        }),
        onWindowCreated: (_ref, window, context) =>
          Effect.sync(() => {
            observeRendererWindow(observability, window, {
              source: context.kind === "game" ? "game" : "electron",
              component:
                context.kind === "game"
                  ? `game-window:${window.id}`
                  : `window:${context.id}:${window.id}`,
            });
          }),
        onGameWindowCreated: (_ref, window) =>
          Effect.sync(() => {
            configureGameWindow(window);
          }),
      };
    }),
  ).pipe(Layer.provideMerge(observabilityLayer));
  const windowLayer = WindowServiceLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        windowEnvironmentLayer,
        windowSnapshotLayer,
        windowLifecycleHooksLayer,
      ),
    ),
  );
  const updatesLayer = Layer.effect(UpdateChecker)(
    Effect.gen(function* () {
      const env = yield* DesktopEnvironment;
      const persistence = yield* DesktopStorage;
      const observability = yield* DesktopObservability;
      const settings = yield* DesktopSettings;
      const cacheStore = makeUpdateCacheStore({
        path: env.appDataPath(updateCacheFileName),
        readJson: persistence.readJson,
        writeJson: persistence.writeJson,
      });

      return makeUpdateChecker({
        currentVersion: app.getVersion(),
        isEnabled: () =>
          settings.get.pipe(
            Effect.map((current) => current.preferences.checkForUpdates),
            Effect.catch(() => Effect.succeed(true)),
          ),
        loadCache: cacheStore.load.pipe(
          Effect.catch((error) =>
            observability
              .warn("updates", "Failed to load update cache", { error })
              .pipe(Effect.as(null)),
          ),
        ),
        saveCache: (cache) =>
          cacheStore.save(cache).pipe(
            Effect.catch((error) =>
              observability.warn("updates", "Failed to save update cache", {
                error,
              }),
            ),
          ),
      });
    }),
  ).pipe(Layer.provideMerge(settingsLayer));
  const ipcLayer = DesktopIpcLive.pipe(Layer.provideMerge(observabilityLayer));
  const stateLayer = Layer.mergeAll(
    AccountSessions.layer,
    ArmyCoordinator.layer,
    EnvironmentStateStore.layer,
    FollowerStateStore.layer,
  );

  return Layer.mergeAll(
    settingsLayer,
    documentsLayer,
    windowLayer,
    updatesLayer,
    ipcLayer,
    stateLayer,
    flashTrustLayer,
    GameWindowClient.layer,
    DesktopLifecycleLive,
  );
};
