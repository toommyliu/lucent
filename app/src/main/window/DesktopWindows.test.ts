import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronSession } from "../electron/ElectronSession";
import {
  ElectronWindow,
  type ElectronWindowHandle,
} from "../electron/ElectronWindow";
import { DesktopWindows, layer as desktopWindowsLayer } from "./DesktopWindows";

const tempDirs = new Set<string>();

const makeTempDir = async (prefix: string): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(path);
  return path;
};

const makeHandle = (id: number): ElectronWindowHandle => ({
  id,
  webContents: {
    id: id + 100,
    isDestroyed: () => false,
    on: () => undefined,
    openDevTools: () => undefined,
    setWindowOpenHandler: () => undefined,
  },
  focus: () => undefined,
  isDestroyed: () => false,
  isMinimized: () => false,
  isVisible: () => true,
  loadFile: () => Promise.resolve(),
  once: () => undefined,
  restore: () => undefined,
  setMenuBarVisibility: () => undefined,
  show: () => undefined,
});

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
      let headerInstallCount = 0;
      const headerWebContentsIds: number[] = [];
      let loadCount = 0;
      let revealCount = 0;
      const electronWindow = ElectronWindow.of({
        create: () =>
          Effect.sync(() => {
            createCount += 1;
            return makeHandle(createCount);
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
        installGameRequestHeaders: (input) =>
          Effect.sync(() => {
            headerInstallCount += 1;
            headerWebContentsIds.push(input.webContentsId);
          }),
      });
      const app = ElectronApp.of({
        appendCommandLineSwitch: () => Effect.void,
        exit: () => Effect.void,
        getVersion: Effect.succeed("0.0.1"),
        isPackaged: Effect.succeed(false),
        on: () => Effect.succeed(() => undefined),
        quit: Effect.void,
        whenReady: Effect.void,
      });
      const layer = desktopWindowsLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(DesktopEnvironment, env),
            Layer.succeed(DesktopObservability, observability),
            Layer.succeed(ElectronApp, app),
            Layer.succeed(ElectronSession, session),
            Layer.succeed(ElectronWindow, electronWindow),
          ),
        ),
      );
      const windows = yield* DesktopWindows.pipe(Effect.provide(layer));

      const first = yield* windows.open("game");
      const second = yield* windows.open("game");

      expect(first).not.toBe(second);
      expect(createCount).toBe(2);
      expect(headerInstallCount).toBe(2);
      expect(headerWebContentsIds).toEqual([101, 102]);
      expect(loadCount).toBe(2);
      expect(revealCount).toBe(2);
    }),
  );
});
