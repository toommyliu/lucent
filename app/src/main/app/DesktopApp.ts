import { unwatchFile, watchFile, promises, type Stats } from "fs";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  session,
  type BrowserWindow as ElectronBrowserWindow,
} from "electron";
import { Effect, Scope, ServiceMap } from "effect";
import { createAppearanceSnapshot } from "../../shared/appearance-snapshot";
import type { AppSettings } from "../../shared/settings";
import { WindowIds } from "../../shared/windows";
import {
  getArtixLauncherRequestHeaders,
  getArtixLauncherUserAgent,
} from "../artix-launcher-headers";
import type { CliOptions } from "../cli";
import { makeMissingFlashPluginWarning } from "../flash/FlashPluginWarning";
import { installDesktopIpcHandlers } from "../ipc/DesktopIpcHandlers";
import { startAccountGameLaunch } from "../ipc/methods/accounts";
import { AccountSessions } from "../backend/accounts/AccountSessions";
import { AccountManagerRepository } from "../backend/accounts/AccountRepository";
import { ScriptLibrary } from "../backend/scripting/ScriptLibrary";
import { createApplicationMenu } from "../window/ApplicationMenu";
import {
  WindowManagerError,
  WindowService,
  type WindowEffectRunner,
} from "../window/WindowService";
import { DesktopEnvironment } from "./DesktopEnvironment";
import { DesktopLifecycle } from "./DesktopLifecycle";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "./DesktopObservability";
import { DesktopSettings } from "../settings/DesktopSettings";
import { UpdateChecker } from "../updates/Updates";

const gameUserAgent = getArtixLauncherUserAgent();

let latestSettings: AppSettings | null = null;

export type EarlyFlashSetupResult =
  | {
      readonly status: "configured";
      readonly flashPluginPath: string | null;
      readonly flashRootPath: string;
      readonly trustedPaths: readonly string[];
    }
  | {
      readonly status: "missing-plugin";
      readonly flashPluginPath: string | null;
      readonly flashRootPath: string;
      readonly trustedPaths: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly cause: unknown;
      readonly flashPluginPath: string | null;
      readonly flashRootPath: string;
      readonly trustedPaths: readonly string[];
    };

const installGameRequestHeaders = (): void => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = details.requestHeaders;
    for (const [name, value] of Object.entries(
      getArtixLauncherRequestHeaders(),
    )) {
      requestHeaders[name] = value;
    }
    callback({ requestHeaders, cancel: false });
  });
};

const installDevRendererReloadWatcher = (
  reloadPath: string | undefined,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    if (!reloadPath) {
      return;
    }

    const listener = (current: Stats, previous: Stats) => {
      if (
        current.mtimeMs === previous.mtimeMs &&
        current.size === previous.size
      ) {
        return;
      }

      if (current.mtimeMs === 0) {
        return;
      }

      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.reloadIgnoringCache();
        }
      }
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        watchFile(reloadPath, { interval: 250 }, listener);
      }),
      () =>
        Effect.sync(() => {
          unwatchFile(reloadPath, listener);
        }),
    );
  });

const clearAppData = (): Promise<void> =>
  Promise.all([
    session.defaultSession.clearCache(),
    session.defaultSession.clearStorageData(),
  ]).then(() => undefined);

const removeDirectory = async (path: string): Promise<void> => {
  if (typeof promises.rm === "function") {
    await promises.rm(path, { recursive: true, force: true });
    return;
  }

  await promises.rmdir(path, { recursive: true }).catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw cause;
    }
  });
};

const clearFlashData = (flashRootPath: string): Promise<void> =>
  removeDirectory(flashRootPath);

const showMissingFlashPluginWarning = (
  flashPluginPath: string | null,
  options: { readonly isDarwin: boolean },
): Promise<void> => {
  const warning = makeMissingFlashPluginWarning(flashPluginPath);
  const bounceId = options.isDarwin ? app.dock.bounce("critical") : undefined;

  return dialog
    .showMessageBox({
      type: "warning",
      title: warning.title,
      message: warning.message,
      detail: warning.detail,
      buttons: ["Quit"],
      defaultId: 0,
      cancelId: 0,
    })
    .then(() => undefined)
    .finally(() => {
      if (bounceId !== undefined) {
        app.dock.cancelBounce(bounceId);
      }
    });
};

const makeWindowEffectRunner = (
  services: ServiceMap.ServiceMap<WindowService>,
): WindowEffectRunner => {
  const runPromise = Effect.runPromiseWith(services);
  return <A>(effect: Effect.Effect<A, WindowManagerError, WindowService>) =>
    runPromise(effect);
};

export const makeProgram = (
  earlyFlashSetup?: EarlyFlashSetupResult,
  cliOptions: CliOptions = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const env = yield* DesktopEnvironment;
      const observability = yield* DesktopObservability;
      const lifecycle = yield* DesktopLifecycle;
      const settings = yield* DesktopSettings;
      const updates = yield* UpdateChecker;

      yield* observability.installProcessHooks;
      yield* observability.info("startup", "Main process starting", {
        appDataDir: env.appDataDir,
        workspaceDir: env.workspaceDir,
        version: app.getVersion(),
      });

      if (earlyFlashSetup?.status === "configured") {
        yield* observability.info("startup", "Flash support configured", {
          flashPluginPath: earlyFlashSetup.flashPluginPath,
          flashRootPath: earlyFlashSetup.flashRootPath,
          trustedPaths: earlyFlashSetup.trustedPaths,
        });
      } else if (earlyFlashSetup?.status === "missing-plugin") {
        yield* observability.warn("startup", "Flash plugin missing", {
          flashPluginPath: earlyFlashSetup.flashPluginPath,
          flashRootPath: earlyFlashSetup.flashRootPath,
          trustedPaths: earlyFlashSetup.trustedPaths,
        });
      } else if (earlyFlashSetup?.status === "failed") {
        yield* observability.error(
          "startup",
          "Flash support setup failed",
          earlyFlashSetup.cause,
          {
            flashPluginPath: earlyFlashSetup.flashPluginPath,
            flashRootPath: earlyFlashSetup.flashRootPath,
            trustedPaths: earlyFlashSetup.trustedPaths,
          },
        );
      }

      const loadedSettings = yield* settings.load;
      yield* settings.installNativeThemeChangeBroadcast;
      latestSettings = loadedSettings;
      yield* settings.onChanged((nextSettings) => {
        latestSettings = nextSettings;
      });

      const services = yield* Effect.services<WindowService>();
      const runWindowEffect = makeWindowEffectRunner(services);

      yield* lifecycle.register({
        startupBlockedByMissingFlashPlugin:
          earlyFlashSetup?.status === "missing-plugin",
      });
      yield* installDesktopIpcHandlers(runWindowEffect);
      yield* installDevRendererReloadWatcher(env.devRendererReloadPath);

      yield* Effect.promise(() => app.whenReady());
      yield* observability.info("startup", "Electron app ready");

      if (earlyFlashSetup?.status === "missing-plugin") {
        yield* Effect.promise(() =>
          showMissingFlashPluginWarning(earlyFlashSetup.flashPluginPath, {
            isDarwin: env.isDarwin,
          }),
        );
        yield* observability.info(
          "startup",
          "Startup blocked until Flash plugin is installed",
        );
        app.quit();
        return;
      }

      installGameRequestHeaders();

      yield* createApplicationMenuEffect(runWindowEffect);

      const windowService = yield* WindowService;
      const cliUsername = cliOptions.username;
      const cliPassword = cliOptions.password;
      if (cliUsername !== undefined && cliPassword !== undefined) {
        const repository = yield* AccountManagerRepository;
        const runtime = yield* AccountSessions;
        const scripts = yield* ScriptLibrary;
        const script =
          cliOptions.scriptPath === undefined
            ? null
            : yield* scripts.read(cliOptions.scriptPath);

        yield* Effect.promise(() =>
          startAccountGameLaunch(
            {
              account: {
                label: cliUsername,
                username: cliUsername,
                password: cliPassword,
              },
              script,
              ...(cliOptions.server === undefined
                ? {}
                : { server: cliOptions.server }),
            },
            {
              runWindowEffect,
              repository,
              runtime,
              scripts,
              observability,
            },
          ),
        );
      } else if (
        (cliOptions.launchMode ?? loadedSettings.preferences.launchMode) ===
        "account-manager"
      ) {
        yield* windowService.openWindow(WindowIds.AccountManager);
      } else {
        yield* windowService.revealGameWindow();
      }

      yield* updates.checkNow();

      yield* Effect.addFinalizer(() =>
        windowService.setQuitting(true).pipe(
          Effect.flatMap(() =>
            observability.info("shutdown", "Main process stopped"),
          ),
          Effect.asVoid,
        ),
      );

      return yield* lifecycle.awaitQuit;
    }),
  );

const createApplicationMenuEffect = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<
  void,
  never,
  DesktopEnvironment | DesktopObservability | DesktopSettings | UpdateChecker
> =>
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const observability = yield* DesktopObservability;
    const settings = yield* DesktopSettings;
    const updates = yield* UpdateChecker;
    const services = yield* Effect.services<
      DesktopObservability | DesktopSettings | UpdateChecker
    >();
    const runPromise = Effect.runPromiseWith(services);

    yield* Effect.promise(() =>
      createApplicationMenu({
        runWindowEffect,
        getSettings: () => runPromise(settings.get),
        updateAppearance: (patch) =>
          runPromise(settings.updateAppearance(patch)),
        checkForUpdates: () => runPromise(updates.checkNow({ force: true })),
        clearAppData,
        clearFlashData: () => clearFlashData(env.flashRootPath),
        logError: (component, message, error, data) => {
          void runPromise(
            observability.error(component, message, error, data),
          ).catch(() => undefined);
        },
        onSettingsChanged: async (listener) =>
          runPromise(
            settings.onChanged(() => {
              listener();
            }),
          ),
      }),
    );
  });

export const getLatestSettingsSnapshot = () => {
  if (latestSettings === null) {
    throw new Error("Settings have not been loaded");
  }

  return latestSettings;
};

export const getLatestAppearanceSnapshot = (settings: AppSettings) => {
  return createAppearanceSnapshot(
    settings.appearance,
    nativeTheme.shouldUseDarkColors,
  );
};

export const configureGameWindow = (win: ElectronBrowserWindow): void => {
  win.webContents.setUserAgent(gameUserAgent);
};

export const observeRendererWindow = (
  observability: DesktopObservabilityShape,
  win: ElectronBrowserWindow,
  options: {
    readonly component: string;
    readonly source?: "electron" | "game";
  },
): void => {
  void Effect.runPromise(
    observability.observeWindow(win, {
      source: options.source ?? "electron",
      component: options.component,
    }),
  ).catch(() => undefined);
};
