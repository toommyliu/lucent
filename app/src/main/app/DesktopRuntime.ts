import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { createAppearanceSnapshot } from "@lucent/core/appearance";
import type { AppSettings } from "@lucent/core/settings";
import type { CliOptions } from "../cli";
import { installDesktopDevRendererReload } from "./DesktopDevRendererReload";
import { DesktopGameRendererRecovery } from "./DesktopGameRendererRecovery";
import type { FlashStartupResult } from "./Preflight";
import { DesktopEnvironment } from "./DesktopEnvironment";
import { DesktopLifecycle } from "./DesktopLifecycle";
import {
  DEFAULT_DESKTOP_OBSERVABILITY_PORT,
  DesktopObservabilityServer,
} from "./observability/DesktopObservabilityServer";
import { DesktopObservability } from "./observability/DesktopObservability";
import { installDesktopRendererObservability } from "./observability/DesktopRendererObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronDialog } from "../electron/ElectronDialog";
import { ElectronTheme } from "../electron/ElectronTheme";
import { makeMissingFlashPluginWarning } from "../flash/FlashPluginWarning";
import { installDesktopIpcHandlers } from "../ipc/DesktopIpcHandlers";
import { DesktopSettings } from "../settings/DesktopSettings";
import { ScriptWorkspace } from "../scripting/ScriptWorkspace";
import { initializeBundledScriptPackages } from "../scripting/BundledScriptPackages";
import { DesktopUpdates } from "../updates/DesktopUpdates";
import { DesktopApplicationMenu } from "../window/DesktopApplicationMenu";
import { DesktopWindows } from "../window/DesktopWindows";

export const installDesktopNativeAppearanceSync = (
  initialSettings: AppSettings,
) =>
  Effect.gen(function* () {
    const observability = yield* DesktopObservability;
    const settingsService = yield* DesktopSettings;
    const theme = yield* ElectronTheme;
    const windows = yield* DesktopWindows;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    const applyNativeAppearance = (settings: AppSettings) =>
      Effect.gen(function* () {
        yield* theme.setThemeMode(settings.appearance.themeMode);
        const systemPrefersDark = yield* theme.shouldUseDarkColors;
        const snapshot = createAppearanceSnapshot(settings, systemPrefersDark);
        yield* windows.setBackgroundColor(snapshot.backgroundColor);
      }).pipe(
        Effect.catch((cause) =>
          observability.warn(
            "appearance",
            "Failed to update Electron native appearance",
            { cause },
          ),
        ),
      );

    yield* applyNativeAppearance(initialSettings);
    const unsubscribe = yield* settingsService.onChanged((settings) => {
      void runPromise(applyNativeAppearance(settings)).catch(() => undefined);
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  });

export const makeDesktopRuntime = (
  cliOptions: CliOptions,
  flash: FlashStartupResult,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const app = yield* ElectronApp;
      const applicationMenu = yield* DesktopApplicationMenu;
      const dialog = yield* ElectronDialog;
      const env = yield* DesktopEnvironment;
      const gameRendererRecovery = yield* DesktopGameRendererRecovery;
      const observabilityServer = yield* DesktopObservabilityServer;
      const lifecycle = yield* DesktopLifecycle;
      const observability = yield* DesktopObservability;
      const settingsService = yield* DesktopSettings;
      const scriptWorkspace = yield* ScriptWorkspace;
      const updates = yield* DesktopUpdates;
      const windows = yield* DesktopWindows;

      yield* observability.installProcessHooks;
      if (env.debug === true) {
        yield* installDesktopRendererObservability;
      }
      yield* lifecycle.register;
      yield* observability.info("startup", "Lucent desktop runtime starting", {
        appDataDir: env.appDataDir,
        logFilePath: observability.logFilePath,
        workspaceDir: env.workspaceDir,
      });

      const settings = yield* settingsService.load;

      yield* app.whenReady;
      yield* gameRendererRecovery.install;
      yield* scriptWorkspace.initialize;
      yield* initializeBundledScriptPackages;
      yield* installDesktopNativeAppearanceSync(settings);
      yield* installDesktopIpcHandlers();
      yield* applicationMenu.install;
      if (env.debug === true) {
        yield* observabilityServer
          .install({
            port: DEFAULT_DESKTOP_OBSERVABILITY_PORT,
          })
          .pipe(
            Effect.catch((cause) =>
              observability.error(
                "observability-server",
                "Failed to start the desktop observability server",
                cause,
                {
                  port: DEFAULT_DESKTOP_OBSERVABILITY_PORT,
                },
              ),
            ),
          );
      }

      if (flash.status === "missing-plugin") {
        yield* observability.warn("startup", "Pepper Flash plugin missing", {
          flashPluginPath: flash.flashPluginPath,
          flashTrustRootPath: flash.flashTrustRootPath,
        });
        yield* dialog.showWarningAndQuit(
          makeMissingFlashPluginWarning(flash.flashPluginPath),
        );
        return;
      }

      if (flash.status === "failed") {
        yield* observability.error(
          "startup",
          "Pepper Flash startup setup failed",
          flash.cause,
          {
            flashPluginPath: flash.flashPluginPath,
            flashTrustRootPath: flash.flashTrustRootPath,
          },
        );
        yield* dialog.showErrorBox(
          "Lucent failed to start",
          "Lucent could not configure Flash trust. Check the logs for details.",
        );
        yield* app.quit;
        return;
      }

      yield* observability.info("startup", "Pepper Flash configured", {
        flashPluginPath: flash.flashPluginPath,
        flashTrustRootPath: flash.flashTrustRootPath,
      });

      const requestedLaunchMode =
        cliOptions.launchMode ?? settings.preferences.launchMode;
      yield* windows.open(
        requestedLaunchMode === "account-manager" ? "account-manager" : "game",
      );
      yield* installDesktopDevRendererReload;

      if (settings.preferences.checkForUpdates) {
        const updateState = yield* updates.checkNow();
        yield* observability.info("updates", "Startup update check completed", {
          status: updateState.status,
        });
      }

      yield* lifecycle.awaitQuit;
    }),
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const observability = yield* DesktopObservability;
        yield* observability.error(
          "startup",
          "Lucent desktop runtime failed",
          Cause.pretty(cause),
        );
        return yield* Effect.failCause(cause);
      }),
    ),
  );
