import { promises as fs } from "fs";

import {
  Menu,
  app,
  session,
  webContents,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import type { ThemeMode } from "@lucent/core/settings";
import {
  DesktopChromiumPerformanceRecording,
  type DesktopChromiumPerformanceRecordingState,
} from "../app/observability/DesktopChromiumPerformanceRecording";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/observability/DesktopObservability";
import {
  DesktopPerformanceTrace,
  type DesktopPerformanceTraceState,
} from "../app/observability/DesktopPerformanceTrace";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronDialog } from "../electron/ElectronDialog";
import { ElectronShell } from "../electron/ElectronShell";
import { resolveFlashTrustRootPath } from "../flash/FlashPaths";
import { DesktopSettings } from "../settings/DesktopSettings";
import { DesktopUpdates } from "../updates/DesktopUpdates";
import { DesktopWindows } from "./DesktopWindows";

export interface DesktopApplicationMenuShape {
  readonly install: Effect.Effect<void, never, Scope.Scope>;
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  DesktopApplicationMenuShape
>()("lucent/desktop/window/DesktopApplicationMenu") {}

const themeModes: readonly {
  readonly label: string;
  readonly mode: ThemeMode;
}[] = [
  { label: "Light", mode: "light" },
  { label: "Dark", mode: "dark" },
  { label: "System", mode: "system" },
];

class DesktopFlashDataClearError extends Schema.TaggedErrorClass<DesktopFlashDataClearError>()(
  "DesktopFlashDataClearError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to clear Flash data.";
  }
}

class DesktopAppDataClearError extends Schema.TaggedErrorClass<DesktopAppDataClearError>()(
  "DesktopAppDataClearError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to clear app data.";
  }
}

const reloadContents = (target: WebContents, bypassCache: boolean): void => {
  if (target.isDestroyed()) {
    return;
  }

  if (bypassCache) {
    target.reloadIgnoringCache();
  } else {
    target.reload();
  }
};

const makeDesktopApplicationMenu = Effect.gen(function* () {
  const electronApp = yield* ElectronApp;
  const chromiumPerformanceRecording =
    yield* DesktopChromiumPerformanceRecording;
  const dialog = yield* ElectronDialog;
  const env = yield* DesktopEnvironment;
  const observability = yield* DesktopObservability;
  const performanceTrace = yield* DesktopPerformanceTrace;
  const settings = yield* DesktopSettings;
  const shell = yield* ElectronShell;
  const updates = yield* DesktopUpdates;
  const windows = yield* DesktopWindows;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const isDarwin = env.platform === "darwin";
  const flashTrustRootPath = resolveFlashTrustRootPath(env.appDataDir);

  const logMenuFailure = (operation: string, cause: unknown): void => {
    void runPromise(
      observability.warn("menu", "Application menu action failed", {
        operation,
        cause,
      }),
    );
  };

  const openSettings = (): void => {
    void runPromise(windows.open("settings")).catch((cause) =>
      logMenuFailure("open-settings", cause),
    );
  };

  const toggleDevTools = (): void => {
    const target = webContents.getFocusedWebContents();
    if (target === null || target.isDestroyed()) {
      return;
    }

    try {
      if (target.isDevToolsOpened()) {
        target.closeDevTools();
      } else {
        // Docked DevTools are painted below BrowserViews, so they must use a
        // separate window for game hosts.
        target.openDevTools({ mode: "detach" });
      }
    } catch (cause) {
      logMenuFailure("toggle-dev-tools", cause);
    }
  };

  const reload =
    (bypassCache: boolean): NonNullable<MenuItemConstructorOptions["click"]> =>
    (_menuItem, browserWindow) => {
      const target = webContents.getFocusedWebContents();
      if (target === null || target.isDestroyed()) {
        return;
      }

      const reloadTarget = (): void => {
        try {
          reloadContents(target, bypassCache);
        } catch (cause) {
          logMenuFailure(
            bypassCache ? "force-reload-renderer" : "reload-renderer",
            cause,
          );
        }
      };

      if (browserWindow === undefined) {
        reloadTarget();
        return;
      }

      void runPromise(
        windows.reloadFocusedGameContents(
          browserWindow.id,
          target.id,
          bypassCache,
        ),
      )
        .then((handled) => {
          if (!handled) reloadTarget();
        })
        .catch((cause) =>
          logMenuFailure(
            bypassCache ? "force-reload-game-view" : "reload-game-view",
            cause,
          ),
        );
    };

  const openWindow = (kind: "account-manager" | "game"): void => {
    void runPromise(windows.open(kind)).catch((cause) =>
      logMenuFailure(`open-${kind}`, cause),
    );
  };

  const checkForUpdates = (): void => {
    void runPromise(updates.checkNow({ force: true })).catch((cause) =>
      logMenuFailure("check-for-updates", cause),
    );
  };

  const showPerformanceTraceFailure = (
    operation: "save" | "start",
    cause: unknown,
  ) =>
    Effect.gen(function* () {
      const starting = operation === "start";
      yield* observability.error(
        "performance-trace",
        starting
          ? "Failed to start performance trace"
          : "Failed to save performance trace",
        cause,
      );
      yield* dialog.showMessageBox({
        type: "warning",
        title: starting
          ? "Performance Trace Not Started"
          : "Performance Trace Not Saved",
        message: starting
          ? "Unable to start the performance trace."
          : "Unable to save the performance trace.",
        detail: "Check the logs and try again.",
        buttons: ["Close"],
        defaultId: 0,
        cancelId: 0,
      });
    }).pipe(Effect.asVoid);

  const startPerformanceTrace = (): void => {
    void runPromise(
      performanceTrace.start.pipe(
        Effect.catch((cause) => showPerformanceTraceFailure("start", cause)),
      ),
    ).catch((cause) => logMenuFailure("start-performance-trace", cause));
  };

  const stopPerformanceTrace = (): void => {
    void runPromise(
      performanceTrace.stop.pipe(
        Effect.flatMap((result) =>
          result === undefined
            ? Effect.void
            : shell.showItemInFolder(result.filePath),
        ),
        Effect.catch((cause) => showPerformanceTraceFailure("save", cause)),
      ),
    ).catch((cause) => logMenuFailure("stop-performance-trace", cause));
  };

  const showChromiumPerformanceRecordingFailure = (
    operation: "save" | "snapshot" | "start",
    cause: unknown,
  ) =>
    Effect.gen(function* () {
      const copy = {
        save: {
          title: "Chromium Recording Not Saved",
          message:
            "Unable to finish saving the Chromium performance recording.",
        },
        snapshot: {
          title: "Heap Snapshot Not Saved",
          message: "Unable to save the heap snapshot.",
        },
        start: {
          title: "Chromium Recording Not Started",
          message: "Unable to start the Chromium performance recording.",
        },
      } as const;
      yield* observability.error(
        "chromium-performance-recording",
        copy[operation].message,
        cause,
      );
      yield* dialog.showMessageBox({
        type: "warning",
        title: copy[operation].title,
        message: copy[operation].message,
        detail:
          operation === "snapshot"
            ? "The performance recording is still running. Check the logs and try again."
            : "Check the logs and try again.",
        buttons: ["Close"],
        defaultId: 0,
        cancelId: 0,
      });
    }).pipe(Effect.asVoid);

  const startChromiumPerformanceRecording = (): void => {
    void runPromise(
      chromiumPerformanceRecording.start.pipe(
        Effect.catch((cause) =>
          showChromiumPerformanceRecordingFailure("start", cause),
        ),
      ),
    ).catch((cause) =>
      logMenuFailure("start-chromium-performance-recording", cause),
    );
  };

  const captureChromiumHeapSnapshot = (): void => {
    void runPromise(
      chromiumPerformanceRecording.captureHeapSnapshot.pipe(
        Effect.flatMap((result) => {
          if (result.failedSnapshotCount === 0) {
            return Effect.void;
          }

          const savedSnapshotCount =
            result.snapshotCount - result.failedSnapshotCount;
          return dialog
            .showMessageBox({
              type: "warning",
              title: "Heap Snapshot Incomplete",
              message: `Saved ${savedSnapshotCount} of ${result.snapshotCount} heap snapshots.`,
              detail:
                "The Chromium performance recording is still running. Check the logs for details.",
              buttons: ["Close"],
              defaultId: 0,
              cancelId: 0,
            })
            .pipe(Effect.asVoid);
        }),
        Effect.catch((cause) =>
          showChromiumPerformanceRecordingFailure("snapshot", cause),
        ),
      ),
    ).catch((cause) => logMenuFailure("capture-chromium-heap-snapshot", cause));
  };

  const stopChromiumPerformanceRecording = (): void => {
    void runPromise(
      chromiumPerformanceRecording.stop.pipe(
        Effect.flatMap((result) =>
          result === undefined
            ? Effect.void
            : shell.showItemInFolder(result.manifestPath),
        ),
        Effect.catch((cause) =>
          showChromiumPerformanceRecordingFailure("save", cause),
        ),
      ),
    ).catch((cause) =>
      logMenuFailure("stop-chromium-performance-recording", cause),
    );
  };

  const removeDirectory = (
    path: string,
  ): Effect.Effect<void, DesktopFlashDataClearError> =>
    Effect.tryPromise({
      try: async () => {
        await fs.rmdir(path, { recursive: true }).catch((cause: unknown) => {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
            throw cause;
          }
        });
      },
      catch: (cause) => new DesktopFlashDataClearError({ cause }),
    });

  const clearAppData: Effect.Effect<void, DesktopAppDataClearError> =
    Effect.tryPromise({
      try: () =>
        Promise.all([
          session.defaultSession.clearCache(),
          session.defaultSession.clearStorageData(),
        ]).then(() => undefined),
      catch: (cause) => new DesktopAppDataClearError({ cause }),
    });

  const showDataClearResult = (
    dataName: "App" | "Flash",
    result: "succeeded" | "failed",
  ) =>
    Effect.gen(function* () {
      if (result === "succeeded") {
        const response = yield* dialog.showMessageBox({
          type: "info",
          title: `${dataName} Data Cleared`,
          message: `${dataName} data was cleared.`,
          buttons: ["Relaunch Now", "Later"],
          defaultId: 0,
          cancelId: 1,
        });

        if (response.response === 0) {
          yield* electronApp.relaunch;
          yield* electronApp.quit;
        }

        return;
      }

      yield* dialog.showMessageBox({
        type: "warning",
        title: `${dataName} Data Clear Failed`,
        message: `Lucent could not clear the ${dataName.toLowerCase()} data.`,
        detail: "Check the logs for details.",
      });
    }).pipe(Effect.asVoid);

  const clearData = (
    dataName: "App" | "Flash",
    clear: Effect.Effect<void, unknown>,
  ): void => {
    void runPromise(
      clear.pipe(
        Effect.flatMap(() => showDataClearResult(dataName, "succeeded")),
        Effect.catch((cause) =>
          observability
            .error("menu", `Failed to clear ${dataName} data`, cause)
            .pipe(
              Effect.flatMap(() => showDataClearResult(dataName, "failed")),
            ),
        ),
      ),
    ).catch((cause) =>
      logMenuFailure(`clear-${dataName.toLowerCase()}-data`, cause),
    );
  };

  const updateTheme = (themeMode: ThemeMode): void => {
    void runPromise(settings.updateAppearance({ themeMode })).catch((cause) =>
      logMenuFailure("update-theme", cause),
    );
  };

  const buildAppearanceMenu = (
    currentThemeMode: ThemeMode,
  ): MenuItemConstructorOptions => ({
    label: "Appearance",
    submenu: themeModes.map(({ label, mode }) => ({
      checked: currentThemeMode === mode,
      click: () => updateTheme(mode),
      label,
      type: "radio",
    })),
  });

  const buildPerformanceTraceMenuItem = (
    state: DesktopPerformanceTraceState,
  ): MenuItemConstructorOptions => {
    switch (state.status) {
      case "idle":
        return {
          label: "Start Performance Trace",
          click: startPerformanceTrace,
        };
      case "recording":
        return {
          label: "Stop and Save Performance Trace",
          click: stopPerformanceTrace,
        };
      case "saving":
        return {
          label: "Saving Performance Trace…",
          enabled: false,
        };
    }
  };

  const buildChromiumPerformanceRecordingMenuItems = (
    state: DesktopChromiumPerformanceRecordingState,
  ): MenuItemConstructorOptions[] => {
    switch (state.status) {
      case "idle":
        return [
          {
            label: "Start Chromium Performance Recording",
            click: startChromiumPerformanceRecording,
          },
        ];
      case "recording":
        return [
          {
            label: "Capture Heap Snapshot",
            click: captureChromiumHeapSnapshot,
          },
          {
            label: "Stop and Save Chromium Recording",
            click: stopChromiumPerformanceRecording,
          },
        ];
      case "snapshotting":
        return [
          {
            label: "Capturing Heap Snapshot…",
            enabled: false,
          },
          {
            label: "Stop and Save Chromium Recording",
            enabled: false,
          },
        ];
      case "saving":
        return [
          {
            label: "Saving Chromium Recording…",
            enabled: false,
          },
        ];
    }
  };

  const buildTemplate = (
    currentThemeMode: ThemeMode,
    performanceTraceState: DesktopPerformanceTraceState,
    chromiumPerformanceRecordingState: DesktopChromiumPerformanceRecordingState,
  ): MenuItemConstructorOptions[] => {
    const settingsMenuItem: MenuItemConstructorOptions = {
      label: "Settings",
      accelerator: isDarwin ? "Command+," : "Control+,",
      click: openSettings,
    };
    const checkForUpdatesMenuItem: MenuItemConstructorOptions = {
      label: "Check for Updates...",
      click: checkForUpdates,
    };
    const dataClearMenuItems: MenuItemConstructorOptions[] = [
      {
        label: "Clear App Data",
        click: () => clearData("App", clearAppData),
      },
      {
        label: "Clear Flash Data",
        click: () => clearData("Flash", removeDirectory(flashTrustRootPath)),
      },
    ];
    const launchMenuItems: MenuItemConstructorOptions[] = [
      {
        label: "New Game Window",
        accelerator: "CmdOrCtrl+N",
        click: () => openWindow("game"),
      },
      {
        label: "Open Account Manager",
        click: () => openWindow("account-manager"),
      },
      { type: "separator" },
    ];
    const fileSubmenu: MenuItemConstructorOptions[] = isDarwin
      ? [...launchMenuItems, { role: "close" }]
      : [
          ...launchMenuItems,
          settingsMenuItem,
          { type: "separator" },
          { role: "quit" },
        ];
    const helpUpdateItems: MenuItemConstructorOptions[] = isDarwin
      ? []
      : [checkForUpdatesMenuItem, { type: "separator" }];
    const helpSubmenu: MenuItemConstructorOptions[] = [
      ...helpUpdateItems,
      buildPerformanceTraceMenuItem(performanceTraceState),
      ...buildChromiumPerformanceRecordingMenuItems(
        chromiumPerformanceRecordingState,
      ),
      { type: "separator" },
      ...dataClearMenuItems,
    ];
    const viewSubmenu: MenuItemConstructorOptions[] = [
      {
        accelerator: "CmdOrCtrl+R",
        click: reload(false),
        label: "Reload",
      },
      {
        accelerator: "CmdOrCtrl+Shift+R",
        click: reload(true),
        label: "Force Reload",
      },
      {
        accelerator: isDarwin ? "Alt+Command+I" : "Control+Shift+I",
        click: toggleDevTools,
        label: "Toggle Developer Tools",
      },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      buildAppearanceMenu(currentThemeMode),
      { type: "separator" },
      { role: "togglefullscreen" },
    ];

    return [
      ...(isDarwin
        ? [
            {
              label: app.name,
              submenu: [
                { role: "about" },
                { type: "separator" },
                settingsMenuItem,
                checkForUpdatesMenuItem,
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            } satisfies MenuItemConstructorOptions,
          ]
        : []),
      { label: "File", submenu: fileSubmenu },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "delete" },
          { role: "selectAll" },
        ],
      },
      { label: "View", submenu: viewSubmenu },
      { role: "windowMenu" },
      { label: "Help", submenu: helpSubmenu },
    ];
  };

  const rebuild = Effect.gen(function* () {
    const current = yield* settings.get;
    const performanceTraceState = yield* performanceTrace.getState;
    const chromiumPerformanceRecordingState =
      yield* chromiumPerformanceRecording.getState;
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildTemplate(
          current.appearance.themeMode,
          performanceTraceState,
          chromiumPerformanceRecordingState,
        ),
      ),
    );
  }).pipe(
    Effect.catch((cause) =>
      observability.warn("menu", "Failed to rebuild application menu", {
        cause,
      }),
    ),
  );

  const install: DesktopApplicationMenuShape["install"] = Effect.gen(
    function* () {
      yield* rebuild;
      const unsubscribe = yield* settings.onChanged(() => {
        void runPromise(rebuild).catch((cause) =>
          logMenuFailure("rebuild", cause),
        );
      });
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
      const unsubscribePerformanceTrace = yield* performanceTrace.onChanged(
        () => {
          void runPromise(rebuild).catch((cause) =>
            logMenuFailure("rebuild-performance-trace", cause),
          );
        },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(unsubscribePerformanceTrace),
      );
      const unsubscribeChromiumPerformanceRecording =
        yield* chromiumPerformanceRecording.onChanged(() => {
          void runPromise(rebuild).catch((cause) =>
            logMenuFailure("rebuild-chromium-performance-recording", cause),
          );
        });
      yield* Effect.addFinalizer(() =>
        Effect.sync(unsubscribeChromiumPerformanceRecording),
      );
    },
  );

  return DesktopApplicationMenu.of({
    install,
  });
});

export const layer = Layer.effect(
  DesktopApplicationMenu,
  makeDesktopApplicationMenu,
);
