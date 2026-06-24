import { Cause, Effect } from "effect";

import type { AppSettings } from "../../shared/settings";
import type { CliOptions } from "../cli";
import { installDesktopDevRendererReload } from "./DesktopDevRendererReload";
import type { FlashStartupResult } from "./Preflight";
import { DesktopEnvironment } from "./DesktopEnvironment";
import { DesktopLifecycle } from "./DesktopLifecycle";
import { DesktopObservability } from "./DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronDialog } from "../electron/ElectronDialog";
import { ElectronTheme } from "../electron/ElectronTheme";
import { makeMissingFlashPluginWarning } from "../flash/FlashPluginWarning";
import { installDesktopIpcHandlers } from "../ipc/DesktopIpcHandlers";
import { DesktopSettings } from "../settings/DesktopSettings";
import { DesktopUpdates } from "../updates/DesktopUpdates";
import { DesktopApplicationMenu } from "../window/DesktopApplicationMenu";
import { DesktopWindows } from "../window/DesktopWindows";

export const installDesktopNativeThemeSync = (initialSettings: AppSettings) =>
  Effect.gen(function* () {
    const observability = yield* DesktopObservability;
    const settingsService = yield* DesktopSettings;
    const theme = yield* ElectronTheme;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    const applyNativeTheme = (settings: AppSettings) =>
      theme
        .setThemeMode(settings.appearance.themeMode)
        .pipe(
          Effect.catch((cause) =>
            observability.warn(
              "appearance",
              "Failed to update Electron native theme",
              { cause },
            ),
          ),
        );

    yield* applyNativeTheme(initialSettings);
    const unsubscribe = yield* settingsService.onChanged((settings) => {
      void runPromise(applyNativeTheme(settings)).catch(() => undefined);
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
      const lifecycle = yield* DesktopLifecycle;
      const observability = yield* DesktopObservability;
      const settingsService = yield* DesktopSettings;
      const updates = yield* DesktopUpdates;
      const windows = yield* DesktopWindows;

      yield* observability.installProcessHooks;
      yield* lifecycle.register;
      yield* observability.info("startup", "Lucent desktop runtime starting", {
        appDataDir: env.appDataDir,
        logFilePath: env.logFilePath,
        workspaceDir: env.workspaceDir,
      });

      const settings = yield* settingsService.load;

      yield* app.whenReady;
      yield* installDesktopNativeThemeSync(settings);
      yield* installDesktopIpcHandlers;
      yield* applicationMenu.install;

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
      if (requestedLaunchMode !== "game") {
        yield* observability.warn(
          "startup",
          "Requested launch mode is not implemented yet; falling back to game",
          { requestedLaunchMode },
        );
      }

      yield* windows.open("game");
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
