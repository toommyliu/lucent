import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { BrowserWindowConstructorOptions } from "electron";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import { Effect, Layer } from "effect";

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: () => ({}),
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
}));

import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import {
  APPEARANCE_SNAPSHOT_ARGUMENT,
  DESKTOP_VIEW_ARGUMENT,
  SETTINGS_SNAPSHOT_ARGUMENT,
  rgbToHex,
} from "../../shared/appearance";
import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronSession } from "../electron/ElectronSession";
import { ElectronTheme } from "../electron/ElectronTheme";
import {
  ElectronWindow,
  type ElectronWindowHandle,
} from "../electron/ElectronWindow";
import { DesktopSettings } from "../settings/DesktopSettings";
import { DesktopWindows, layer as desktopWindowsLayer } from "./DesktopWindows";

const tempDirs = new Set<string>();

const makeTempDir = async (prefix: string): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(path);
  return path;
};

type TestWindowListener = (...args: readonly unknown[]) => void;

interface TestWindowHandle extends ElectronWindowHandle {
  readonly emit: (eventName: string, ...args: readonly unknown[]) => void;
  readonly hideCount: () => number;
}

const addWindowListener = (
  collection: Map<string, TestWindowListener[]>,
  eventName: string,
  listener: TestWindowListener,
): void => {
  collection.set(eventName, [...(collection.get(eventName) ?? []), listener]);
};

const makeHandle = (id: number): TestWindowHandle => {
  const listeners = new Map<string, TestWindowListener[]>();
  const onceListeners = new Map<string, TestWindowListener[]>();
  let hiddenCount = 0;
  let visible = true;

  return {
    id,
    webContents: {
      id: id + 100,
      isDestroyed: () => false,
      on: () => undefined,
      openDevTools: () => undefined,
      setWindowOpenHandler: () => undefined,
    },
    emit: (eventName, ...args) => {
      for (const listener of listeners.get(eventName) ?? []) {
        listener(...args);
      }
      const currentOnceListeners = onceListeners.get(eventName) ?? [];
      onceListeners.delete(eventName);
      for (const listener of currentOnceListeners) {
        listener(...args);
      }
    },
    focus: () => undefined,
    hide: () => {
      hiddenCount += 1;
      visible = false;
    },
    hideCount: () => hiddenCount,
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => visible,
    loadFile: () => Promise.resolve(),
    on: (eventName, listener) =>
      addWindowListener(listeners, eventName, listener),
    once: (eventName, listener) =>
      addWindowListener(onceListeners, eventName, listener),
    restore: () => undefined,
    setMenuBarVisibility: () => undefined,
    show: () => {
      visible = true;
    },
  };
};

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { force: true, recursive: true })),
  );
  tempDirs.clear();
});

describe("DesktopWindows", () => {
  it.effect("creates a separate game window instance for each game open", () =>
    Effect.gen(function* () {
      const appDataDir = yield* Effect.promise(() =>
        makeTempDir("lucent-window-data-"),
      );
      const workspaceDir = yield* Effect.promise(() =>
        makeTempDir("lucent-window-workspace-"),
      );
      const env = makeDesktopEnvironment({
        appDataDir,
        assetsDir: join(appDataDir, "assets"),
        isDev: true,
        platform: "darwin",
        rendererDir: join(appDataDir, "renderer"),
        workspaceDir,
      });
      const observability = DesktopObservability.of({
        debug: () => Effect.void,
        error: () => Effect.void,
        info: () => Effect.void,
        installProcessHooks: Effect.void,
        warn: () => Effect.void,
      });

      let createCount = 0;
      let registeredGameWebContentsCount = 0;
      let unregisteredGameWebContentsCount = 0;
      const registeredGameWebContentsIds: number[] = [];
      let loadCount = 0;
      let revealCount = 0;
      const createdHandles: TestWindowHandle[] = [];
      const createdOptions: BrowserWindowConstructorOptions[] = [];
      const electronWindow = ElectronWindow.of({
        create: (options) =>
          Effect.sync(() => {
            createCount += 1;
            createdOptions.push(options);
            const handle = makeHandle(createCount);
            createdHandles.push(handle);
            return handle;
          }),
        loadFile: () =>
          Effect.sync(() => {
            loadCount += 1;
          }),
        reveal: () =>
          Effect.sync(() => {
            revealCount += 1;
          }),
      });
      const session = ElectronSession.of({
        registerGameWebContents: (webContentsId) =>
          Effect.sync(() => {
            registeredGameWebContentsCount += 1;
            registeredGameWebContentsIds.push(webContentsId);
            return () => {
              unregisteredGameWebContentsCount += 1;
            };
          }),
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
      const theme = ElectronTheme.of({
        setThemeMode: () => Effect.void,
        shouldUseDarkColors: Effect.succeed(true),
      });
      const layer = desktopWindowsLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(DesktopEnvironment, env),
            Layer.succeed(DesktopObservability, observability),
            Layer.succeed(ElectronApp, app),
            Layer.succeed(ElectronSession, session),
            Layer.succeed(ElectronTheme, theme),
            Layer.succeed(ElectronWindow, electronWindow),
            Layer.succeed(DesktopSettings, settings),
          ),
        ),
      );
      const windows = yield* DesktopWindows.pipe(Effect.provide(layer));

      const first = yield* windows.open("game");
      const second = yield* windows.open("game");

      expect(first).not.toBe(second);
      expect(createCount).toBe(2);
      expect(createdOptions[0]?.backgroundColor).toBe(
        rgbToHex(DEFAULT_APP_SETTINGS.appearance.themes.dark.tokens.background),
      );
      expect(createdOptions[0]?.webPreferences?.preload).toBe(env.preloadPath);
      expect(createdOptions[0]?.webPreferences?.additionalArguments).toEqual(
        expect.arrayContaining([
          `${DESKTOP_VIEW_ARGUMENT}=game`,
          expect.stringContaining(`${APPEARANCE_SNAPSHOT_ARGUMENT}=`),
          expect.stringContaining(`${SETTINGS_SNAPSHOT_ARGUMENT}=`),
        ]),
      );
      expect(registeredGameWebContentsCount).toBe(2);
      expect(registeredGameWebContentsIds).toEqual([101, 102]);
      expect(loadCount).toBe(2);
      expect(revealCount).toBe(2);

      createdHandles[0]?.emit("closed");

      expect(unregisteredGameWebContentsCount).toBe(1);
    }),
  );

  it.effect("reuses the hidden settings window after close", () =>
    Effect.gen(function* () {
      const appDataDir = yield* Effect.promise(() =>
        makeTempDir("lucent-window-data-"),
      );
      const workspaceDir = yield* Effect.promise(() =>
        makeTempDir("lucent-window-workspace-"),
      );
      const env = makeDesktopEnvironment({
        appDataDir,
        assetsDir: join(appDataDir, "assets"),
        isDev: true,
        platform: "darwin",
        rendererDir: join(appDataDir, "renderer"),
        workspaceDir,
      });
      const observability = DesktopObservability.of({
        debug: () => Effect.void,
        error: () => Effect.void,
        info: () => Effect.void,
        installProcessHooks: Effect.void,
        warn: () => Effect.void,
      });

      let createCount = 0;
      let loadCount = 0;
      let revealCount = 0;
      const createdHandles: TestWindowHandle[] = [];
      const electronWindow = ElectronWindow.of({
        create: () =>
          Effect.sync(() => {
            createCount += 1;
            const handle = makeHandle(createCount);
            createdHandles.push(handle);
            return handle;
          }),
        loadFile: () =>
          Effect.sync(() => {
            loadCount += 1;
          }),
        reveal: (window) =>
          Effect.sync(() => {
            revealCount += 1;
            if (!window.isVisible()) {
              window.show();
            }
            window.focus();
          }),
      });
      const session = ElectronSession.of({
        registerGameWebContents: () => Effect.succeed(() => undefined),
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
      const theme = ElectronTheme.of({
        setThemeMode: () => Effect.void,
        shouldUseDarkColors: Effect.succeed(true),
      });
      const layer = desktopWindowsLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(DesktopEnvironment, env),
            Layer.succeed(DesktopObservability, observability),
            Layer.succeed(ElectronApp, app),
            Layer.succeed(ElectronSession, session),
            Layer.succeed(ElectronTheme, theme),
            Layer.succeed(ElectronWindow, electronWindow),
            Layer.succeed(DesktopSettings, settings),
          ),
        ),
      );
      const windows = yield* DesktopWindows.pipe(Effect.provide(layer));

      const first = yield* windows.open("settings");
      let closePrevented = false;
      createdHandles[0]?.emit("close", {
        preventDefault: () => {
          closePrevented = true;
        },
      });
      const second = yield* windows.open("settings");

      expect(second).toBe(first);
      expect(closePrevented).toBe(true);
      expect(createdHandles[0]?.hideCount()).toBe(1);
      expect(createCount).toBe(1);
      expect(loadCount).toBe(1);
      expect(revealCount).toBe(2);
    }),
  );
});
