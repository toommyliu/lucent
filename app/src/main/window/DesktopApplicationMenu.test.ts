import { describe, expect, it } from "@effect/vitest";
import type { MessageBoxOptions } from "electron";
import { vi } from "vitest";
import { Effect, Layer } from "effect";

import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppSettings,
  type ThemeMode,
} from "../../shared/settings";
import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronDialog } from "../electron/ElectronDialog";
import { DesktopSettings } from "../settings/DesktopSettings";
import { DesktopUpdates } from "../updates/DesktopUpdates";
import { DesktopWindows } from "./DesktopWindows";

const menuMock = vi.hoisted(() => ({
  lastTemplate: undefined as unknown,
  buildFromTemplate: vi.fn((template: unknown) => template),
  clearCache: vi.fn(() => Promise.resolve()),
  clearStorageData: vi.fn(() => Promise.resolve()),
  setApplicationMenu: vi.fn((menu: unknown) => {
    menuMock.lastTemplate = menu;
  }),
}));

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: menuMock.buildFromTemplate,
    setApplicationMenu: menuMock.setApplicationMenu,
  },
  app: {
    name: "Lucent",
  },
  session: {
    defaultSession: {
      clearCache: menuMock.clearCache,
      clearStorageData: menuMock.clearStorageData,
    },
  },
}));

import {
  DesktopApplicationMenu,
  layer as desktopApplicationMenuLayer,
} from "./DesktopApplicationMenu";

type MenuItem = {
  readonly checked?: boolean;
  readonly click?: () => void;
  readonly label?: string;
  readonly submenu?: readonly MenuItem[];
};

const findMenuItem = (items: readonly MenuItem[], label: string): MenuItem => {
  const item = items.find((entry) => entry.label === label);
  if (item === undefined) {
    throw new Error(`Missing menu item: ${label}`);
  }
  return item;
};

const findMenuItemRecursive = (
  items: readonly MenuItem[],
  label: string,
): MenuItem => {
  const find = (nextItems: readonly MenuItem[]): MenuItem | undefined => {
    for (const item of nextItems) {
      if (item.label === label) {
        return item;
      }

      if (Array.isArray(item.submenu)) {
        const match = find(item.submenu);
        if (match !== undefined) {
          return match;
        }
      }
    }

    return undefined;
  };

  const item = find(items);
  if (item !== undefined) {
    return item;
  }

  throw new Error(`Missing menu item: ${label}`);
};

const countMenuItemsRecursive = (
  items: readonly MenuItem[],
  label: string,
): number =>
  items.reduce((count, item) => {
    const nestedCount = Array.isArray(item.submenu)
      ? countMenuItemsRecursive(item.submenu, label)
      : 0;
    return count + (item.label === label ? 1 : 0) + nestedCount;
  }, 0);

const latestMenuTemplate = (): readonly MenuItem[] => {
  const template = menuMock.lastTemplate;
  if (!Array.isArray(template)) {
    throw new Error("Expected the Electron menu template to be captured.");
  }
  return template as readonly MenuItem[];
};

const appearanceItems = (): readonly MenuItem[] => {
  const view = findMenuItem(latestMenuTemplate(), "View");
  if (!Array.isArray(view.submenu)) {
    throw new Error("Expected View submenu.");
  }
  const appearance = findMenuItem(view.submenu, "Appearance");
  if (!Array.isArray(appearance.submenu)) {
    throw new Error("Expected Appearance submenu.");
  }
  return appearance.submenu;
};

describe("DesktopApplicationMenu", () => {
  it.effect("updates appearance from View and rebuilds checked state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let current: AppSettings = DEFAULT_APP_SETTINGS;
        const listeners = new Set<(settings: AppSettings) => void>();
        const updates: ThemeMode[] = [];
        const settings = DesktopSettings.of({
          get: Effect.sync(() => current),
          load: Effect.sync(() => current),
          onChanged: (listener) =>
            Effect.sync(() => {
              listeners.add(listener);
              return () => {
                listeners.delete(listener);
              };
            }),
          resetAppearance: Effect.sync(() => current),
          resetHotkeys: Effect.sync(() => current),
          updateAppearance: (patch) =>
            Effect.sync(() => {
              if (patch.themeMode !== undefined) {
                updates.push(patch.themeMode);
                current = normalizeAppSettings({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    themeMode: patch.themeMode,
                  },
                });
              }
              for (const listener of listeners) {
                listener(current);
              }
              return current;
            }),
          updateHotkeys: () => Effect.sync(() => current),
          updatePreferences: () => Effect.sync(() => current),
        });
        const observability = DesktopObservability.of({
          debug: () => Effect.void,
          error: () => Effect.void,
          info: () => Effect.void,
          installProcessHooks: Effect.void,
          warn: () => Effect.void,
        });
        const desktopUpdates = DesktopUpdates.of({
          checkNow: () =>
            Effect.succeed({
              status: "checking",
              currentVersion: "0.0.1",
              startedAt: "",
            }),
          getState: Effect.succeed({ status: "idle", currentVersion: "0.0.1" }),
          onStateChanged: () => Effect.succeed(() => undefined),
          openReleasePage: Effect.succeed(false),
        });
        const windows = DesktopWindows.of({
          open: () => Effect.succeed("settings-1"),
          reveal: () => Effect.succeed(true),
        });
        const app = ElectronApp.of({
          appendCommandLineSwitch: () => Effect.void,
          exit: () => Effect.void,
          getVersion: Effect.succeed("0.0.1"),
          isPackaged: Effect.succeed(false),
          on: () => Effect.succeed(() => undefined),
          relaunch: Effect.void,
          quit: Effect.void,
          whenReady: Effect.void,
        });
        const dialog = ElectronDialog.of({
          showErrorBox: () => Effect.void,
          showMessageBox: () =>
            Effect.succeed({ checkboxChecked: false, response: 1 }),
          showWarningAndQuit: () => Effect.void,
        });
        const env = makeDesktopEnvironment({
          appDataDir: "/internal/Lucent",
          assetsDir: "/assets",
          isDev: true,
          platform: "darwin",
          rendererDir: "/renderer",
          workspaceDir: "/workspace",
        });
        const layer = desktopApplicationMenuLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(DesktopEnvironment, env),
              Layer.succeed(DesktopObservability, observability),
              Layer.succeed(ElectronApp, app),
              Layer.succeed(ElectronDialog, dialog),
              Layer.succeed(DesktopSettings, settings),
              Layer.succeed(DesktopUpdates, desktopUpdates),
              Layer.succeed(DesktopWindows, windows),
            ),
          ),
        );
        const menu = yield* DesktopApplicationMenu.pipe(Effect.provide(layer));

        yield* menu.install;

        const file = findMenuItem(latestMenuTemplate(), "File");
        const help = findMenuItem(latestMenuTemplate(), "Help");
        expect(file.submenu?.some((item) => item.label === "Settings")).toBe(
          false,
        );
        expect(
          help.submenu?.some((item) => item.label === "Check for Updates..."),
        ).toBe(false);
        expect(countMenuItemsRecursive(latestMenuTemplate(), "Settings")).toBe(
          1,
        );
        expect(
          countMenuItemsRecursive(latestMenuTemplate(), "Check for Updates..."),
        ).toBe(1);

        expect(findMenuItem(appearanceItems(), "Dark").checked).toBe(true);
        findMenuItem(appearanceItems(), "System").click?.();

        yield* Effect.promise(() => Promise.resolve());

        expect(updates).toEqual(["system"]);
        expect(findMenuItem(appearanceItems(), "System").checked).toBe(true);
      }),
    ),
  );

  it.effect(
    "clears app data from the Help menu and shows the result prompt",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          menuMock.clearCache.mockClear();
          menuMock.clearStorageData.mockClear();
          const messages: MessageBoxOptions[] = [];
          const settings = DesktopSettings.of({
            get: Effect.succeed(DEFAULT_APP_SETTINGS),
            load: Effect.succeed(DEFAULT_APP_SETTINGS),
            onChanged: () => Effect.succeed(() => undefined),
            resetAppearance: Effect.succeed(DEFAULT_APP_SETTINGS),
            resetHotkeys: Effect.succeed(DEFAULT_APP_SETTINGS),
            updateAppearance: () => Effect.succeed(DEFAULT_APP_SETTINGS),
            updateHotkeys: () => Effect.succeed(DEFAULT_APP_SETTINGS),
            updatePreferences: () => Effect.succeed(DEFAULT_APP_SETTINGS),
          });
          const observability = DesktopObservability.of({
            debug: () => Effect.void,
            error: () => Effect.void,
            info: () => Effect.void,
            installProcessHooks: Effect.void,
            warn: () => Effect.void,
          });
          const desktopUpdates = DesktopUpdates.of({
            checkNow: () =>
              Effect.succeed({ status: "idle", currentVersion: "0.0.1" }),
            getState: Effect.succeed({
              status: "idle",
              currentVersion: "0.0.1",
            }),
            onStateChanged: () => Effect.succeed(() => undefined),
            openReleasePage: Effect.succeed(false),
          });
          const windows = DesktopWindows.of({
            open: () => Effect.succeed("settings-1"),
            reveal: () => Effect.succeed(true),
          });
          const app = ElectronApp.of({
            appendCommandLineSwitch: () => Effect.void,
            exit: () => Effect.void,
            getVersion: Effect.succeed("0.0.1"),
            isPackaged: Effect.succeed(false),
            on: () => Effect.succeed(() => undefined),
            relaunch: Effect.void,
            quit: Effect.void,
            whenReady: Effect.void,
          });
          const dialog = ElectronDialog.of({
            showErrorBox: () => Effect.void,
            showMessageBox: (options) =>
              Effect.sync(() => {
                messages.push(options);
                return { checkboxChecked: false, response: 1 };
              }),
            showWarningAndQuit: () => Effect.void,
          });
          const env = makeDesktopEnvironment({
            appDataDir: "/internal/Lucent",
            assetsDir: "/assets",
            isDev: true,
            platform: "darwin",
            rendererDir: "/renderer",
            workspaceDir: "/workspace",
          });
          const layer = desktopApplicationMenuLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(DesktopEnvironment, env),
                Layer.succeed(DesktopObservability, observability),
                Layer.succeed(ElectronApp, app),
                Layer.succeed(ElectronDialog, dialog),
                Layer.succeed(DesktopSettings, settings),
                Layer.succeed(DesktopUpdates, desktopUpdates),
                Layer.succeed(DesktopWindows, windows),
              ),
            ),
          );
          const menu = yield* DesktopApplicationMenu.pipe(
            Effect.provide(layer),
          );

          yield* menu.install;
          findMenuItemRecursive(
            latestMenuTemplate(),
            "Clear App Data",
          ).click?.();
          yield* Effect.promise(
            () => new Promise((resolve) => setTimeout(resolve, 0)),
          );

          expect(menuMock.clearCache).toHaveBeenCalledTimes(1);
          expect(menuMock.clearStorageData).toHaveBeenCalledTimes(1);
          expect(messages).toMatchObject([
            {
              message: "App data was cleared.",
              title: "App Data Cleared",
            },
          ]);
        }),
      ),
  );
});
