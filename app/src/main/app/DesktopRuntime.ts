import { Cause, Effect } from "effect";

import type { CliOptions } from "../cli";
import type { FlashStartupResult } from "./Preflight";
import { DesktopEnvironment } from "./DesktopEnvironment";
import { DesktopLifecycle } from "./DesktopLifecycle";
import { DesktopObservability } from "./DesktopObservability";
import { DesktopData } from "../data/DesktopData";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronDialog } from "../electron/ElectronDialog";
import { makeMissingFlashPluginWarning } from "../flash/FlashPluginWarning";
import { DesktopUpdates } from "../updates/DesktopUpdates";
import { DesktopWindows } from "../window/DesktopWindows";

export const makeDesktopRuntime = (
  cliOptions: CliOptions,
  flash: FlashStartupResult,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const app = yield* ElectronApp;
      const data = yield* DesktopData;
      const dialog = yield* ElectronDialog;
      const env = yield* DesktopEnvironment;
      const lifecycle = yield* DesktopLifecycle;
      const observability = yield* DesktopObservability;
      const updates = yield* DesktopUpdates;
      const windows = yield* DesktopWindows;

      yield* observability.installProcessHooks;
      yield* lifecycle.register;
      yield* observability.info("startup", "Lucent desktop runtime starting", {
        appDataDir: env.appDataDir,
        logFilePath: env.logFilePath,
        workspaceDir: env.workspaceDir,
      });

      const settings = yield* data.loadSettings;

      yield* app.whenReady;

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
