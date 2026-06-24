import { promises as fs } from "fs";

import { Menu, app, session, type MenuItemConstructorOptions } from "electron";

import { Context, Effect, Layer, Schema, Scope } from "effect";

import type { ThemeMode } from "../../shared/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronDialog } from "../electron/ElectronDialog";
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

const makeDesktopApplicationMenu = Effect.gen(function* () {
  const electronApp = yield* ElectronApp;
  const dialog = yield* ElectronDialog;
  const env = yield* DesktopEnvironment;
  const observability = yield* DesktopObservability;
  const settings = yield* DesktopSettings;
  const updates = yield* DesktopUpdates;
  const windows = yield* DesktopWindows;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const isDarwin = env.platform === "darwin";

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

  const checkForUpdates = (): void => {
    void runPromise(updates.checkNow({ force: true })).catch((cause) =>
      logMenuFailure("check-for-updates", cause),
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

  const buildTemplate = (
    currentThemeMode: ThemeMode,
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
        click: () =>
          clearData("Flash", removeDirectory(env.flashTrustRootPath)),
      },
    ];
    const fileSubmenu: MenuItemConstructorOptions[] = isDarwin
      ? [{ role: "close" }]
      : [settingsMenuItem, { type: "separator" }, { role: "quit" }];
    const helpUpdateItems: MenuItemConstructorOptions[] = isDarwin
      ? []
      : [checkForUpdatesMenuItem, { type: "separator" }];
    const helpSubmenu: MenuItemConstructorOptions[] = [
      ...helpUpdateItems,
      ...dataClearMenuItems,
    ];
    const viewSubmenu: MenuItemConstructorOptions[] = [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
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
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(buildTemplate(current.appearance.themeMode)),
    );
  }).pipe(
    Effect.catch((cause) =>
      observability.warn("menu", "Failed to rebuild application menu", {
        cause,
      }),
    ),
  );

  return DesktopApplicationMenu.of({
    install: Effect.gen(function* () {
      yield* rebuild;
      const unsubscribe = yield* settings.onChanged(() => {
        void runPromise(rebuild).catch((cause) =>
          logMenuFailure("rebuild", cause),
        );
      });
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    }),
  });
});

export const layer = Layer.effect(
  DesktopApplicationMenu,
  makeDesktopApplicationMenu,
);
