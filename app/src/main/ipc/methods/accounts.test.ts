import { EventEmitter } from "events";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Rectangle,
} from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { createAppearanceSnapshot } from "../../../shared/appearance-snapshot";
import {
  AccountManagerIpcChannels,
  type AccountGameLaunchPayload,
} from "../../../shared/ipc";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HOTKEYS,
  DEFAULT_PREFERENCES,
} from "../../../shared/settings";
import type { AccountManagerRepositoryShape } from "../../persistence/accounts/AccountRepository";
import type { AccountManagerStorage } from "../../persistence/accounts/AccountStore";
import {
  makeWindowService,
  WindowService,
  type ElectronWindowRuntime,
  type WindowEffectRunner,
  type WindowManagerConfig,
} from "../../window/WindowService";
import type { WorkspaceFilesShape } from "../../workspace/WorkspaceFiles";
import {
  normalizeLaunchRequest,
  resolveAccountLaunchTileBounds,
  startAccountGameLaunch,
} from "./accounts";

class FakeWebContents extends EventEmitter {
  public readonly sent: {
    readonly channel: string;
    readonly args: readonly unknown[];
  }[] = [];

  public isDestroyed(): boolean {
    return false;
  }

  public send(channel: string, ...args: readonly unknown[]): void {
    this.sent.push({ channel, args });
  }
}

class FakeWindow extends EventEmitter {
  public readonly webContents = new FakeWebContents();
  public visible = false;
  public destroyed = false;
  public bounds: Rectangle | null = null;

  public constructor(
    public readonly id: number,
    public readonly options: BrowserWindowConstructorOptions,
  ) {
    super();
  }

  public async loadFile(): Promise<void> {}

  public async loadURL(): Promise<void> {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public isMinimized(): boolean {
    return false;
  }

  public restore(): void {}

  public show(): void {
    this.visible = true;
  }

  public focus(): void {
    this.emit("focus");
  }

  public setBounds(bounds: Rectangle): void {
    this.bounds = bounds;
  }

  public destroy(): void {
    this.destroyed = true;
    this.emit("closed");
  }
}

let tempDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lucent-account-launch-"));
});

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

const makeRepository = (): AccountManagerRepositoryShape => {
  const storage: AccountManagerStorage = { accounts: [], groups: {} };
  return {
    storagePath: "/tmp/accounts.json",
    get: Effect.succeed(storage),
    set: (next) => Effect.succeed(next),
    update: (f) => Effect.succeed(f(storage)),
    toState: (sessions) =>
      Effect.succeed({
        accounts: storage.accounts,
        groups: storage.groups,
        sessions,
        storagePath: "/tmp/accounts.json",
      }),
  };
};

const makeWorkspace = (scriptsDir: string): WorkspaceFilesShape => ({
  scriptsDir,
  flashPluginPath: null,
  readScript: () => Effect.die("not used"),
  readArmyConfig: () => Effect.die("not used"),
});

const makeHarness = (options?: {
  readonly cursorDisplayWorkArea?: Rectangle;
}): {
  readonly runWindowEffect: WindowEffectRunner;
  readonly windows: readonly FakeWindow[];
} => {
  const windows: FakeWindow[] = [];
  let nextId = 1;
  const cursorDisplayWorkArea = options?.cursorDisplayWorkArea ?? {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  };
  const config: WindowManagerConfig = {
    appIconPath: "/assets/icon.png",
    gameWindowHtmlPath: "/renderer/game/index.html",
    isDev: false,
    platform: "darwin",
    preloadPath: "/preload.js",
    windowHtmlPath: (id) => `/renderer/${id}/index.html`,
    getSettingsSnapshot: () => ({
      preferences: DEFAULT_PREFERENCES,
      appearance: DEFAULT_APPEARANCE,
      hotkeys: DEFAULT_HOTKEYS,
    }),
    getAppearanceSnapshot: (settings) =>
      createAppearanceSnapshot(settings.appearance, true),
    quitApp: () => undefined,
  };
  const runtime: ElectronWindowRuntime = {
    platform: "darwin",
    createWindow: (options) => {
      const window = new FakeWindow(nextId++, options);
      windows.push(window);
      return window as unknown as BrowserWindow;
    },
    fromId: (id) =>
      (windows.find((window) => window.id === id) ??
        null) as unknown as BrowserWindow | null,
    getAllWindows: () => windows as unknown as BrowserWindow[],
    getFocusedWindow: () => null,
    getCenteredPosition: () => ({ x: 0, y: 0 }),
    getCursorDisplayWorkArea: () => cursorDisplayWorkArea,
    focusApp: () => {},
  };
  const service = makeWindowService(config, runtime);
  const layer = Layer.succeed(WindowService, service);

  return {
    runWindowEffect: (effect) =>
      Effect.runPromise(effect.pipe(Effect.provide(layer))),
    windows,
  };
};

describe("account launch tiling", () => {
  const workArea: Rectangle = {
    x: 10,
    y: 20,
    width: 1_000,
    height: 800,
  };

  it.each([
    [
      "horizontal splits 2 accounts into columns",
      { algorithm: "horizontal", index: 1, count: 2 },
      { x: 510, y: 20, width: 500, height: 800 },
    ],
    [
      "vertical splits 3 accounts into rows",
      { algorithm: "vertical", index: 2, count: 3 },
      { x: 10, y: 553, width: 1_000, height: 267 },
    ],
    [
      "auto grid places 4 accounts in corner order",
      { algorithm: "auto-grid", index: 2, count: 4 },
      { x: 10, y: 420, width: 500, height: 400 },
    ],
    [
      "auto grid makes a near-square grid for 5 accounts",
      { algorithm: "auto-grid", index: 4, count: 5 },
      { x: 343, y: 420, width: 333, height: 400 },
    ],
    [
      "auto grid makes a near-square grid for 3 accounts",
      { algorithm: "auto-grid", index: 2, count: 3 },
      { x: 10, y: 420, width: 500, height: 400 },
    ],
  ] as const)(
    "%s",
    (_name, tiling, expected) => {
      expect(resolveAccountLaunchTileBounds(workArea, tiling)).toEqual(
        expected,
      );
    },
  );

  it("does not resolve bounds when tiling is none", () => {
    expect(
      resolveAccountLaunchTileBounds(workArea, {
        algorithm: "none",
        index: 0,
        count: 1,
      }),
    ).toBeNull();
  });

  it("rejects invalid launch tiling payloads during request normalization", () => {
    expect(() =>
      normalizeLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "diagonal", index: 0, count: 2 },
      }),
    ).toThrow("Invalid launch tiling algorithm");
    expect(() =>
      normalizeLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "horizontal", index: 0, count: 0 },
      }),
    ).toThrow("Launch tiling count must be a positive integer");
    expect(() =>
      normalizeLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "horizontal", index: 2, count: 2 },
      }),
    ).toThrow("Launch tiling index is out of range");
  });
});

describe("account game launch", () => {
  it("delivers the same refreshed launch payload shape the game renderer consumes", async () => {
    if (tempDir === undefined) {
      throw new Error("Missing temp directory");
    }

    const scriptsDir = join(tempDir, "scripts");
    const scriptPath = join(scriptsDir, "farm.js");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(scriptPath, "module.exports = 'fresh';\n", "utf8");
    const harness = makeHarness();

    const result = await startAccountGameLaunch(
      {
        account: {
          label: "Hero",
          username: "Hero",
          password: "secret",
        },
        server: "Yorumi",
        script: {
          source: "module.exports = 'stale';\n",
          path: scriptPath,
          name: "farm.js",
        },
      },
      {
        runWindowEffect: harness.runWindowEffect,
        repository: makeRepository(),
        workspace: makeWorkspace(scriptsDir),
        observability: {
          error: vi.fn(() => Effect.succeed({} as never)),
        },
      },
    );

    const [gameWindow] = harness.windows;
    if (gameWindow === undefined) {
      throw new Error("Missing game window");
    }

    const sentLaunch = gameWindow.webContents.sent.find(
      (message) => message.channel === AccountManagerIpcChannels.gameLaunch,
    );
    const payload = sentLaunch?.args[0] as AccountGameLaunchPayload | undefined;

    expect(result.gameWindowId).toBe(gameWindow.id);
    expect(gameWindow.bounds).toBeNull();
    expect(payload).toMatchObject({
      account: {
        label: "Hero",
        username: "Hero",
        password: "secret",
      },
      gameWindowId: gameWindow.id,
      server: "Yorumi",
      script: {
        source: "module.exports = 'fresh';\n",
        name: "farm.js",
      },
    });
    gameWindow.destroy();
  });

  it("creates tiled game windows with initial bounds", async () => {
    if (tempDir === undefined) {
      throw new Error("Missing temp directory");
    }

    const harness = makeHarness({
      cursorDisplayWorkArea: { x: 0, y: 0, width: 1_200, height: 800 },
    });

    await startAccountGameLaunch(
      {
        account: {
          label: "Hero",
          username: "Hero",
          password: "secret",
        },
        tiling: {
          algorithm: "auto-grid",
          index: 1,
          count: 4,
        },
      },
      {
        runWindowEffect: harness.runWindowEffect,
        repository: makeRepository(),
        workspace: makeWorkspace(tempDir),
        observability: {
          error: vi.fn(() => Effect.succeed({} as never)),
        },
      },
    );

    const [gameWindow] = harness.windows;
    if (gameWindow === undefined) {
      throw new Error("Missing game window");
    }

    expect(gameWindow.bounds).toBeNull();
    expect(gameWindow.options).toMatchObject({
      useContentSize: false,
      x: 600,
      y: 0,
      width: 600,
      height: 400,
    });
    gameWindow.destroy();
  });
});
