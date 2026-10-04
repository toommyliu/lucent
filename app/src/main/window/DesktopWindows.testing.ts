import { EventEmitter } from "node:events";

import * as Effect from "effect/Effect";

import { DEFAULT_APP_SETTINGS } from "@lucent/core/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronGameView } from "../electron/ElectronGameView";
import { ElectronSession } from "../electron/ElectronSession";
import { ElectronShell } from "../electron/ElectronShell";
import { ElectronTheme } from "../electron/ElectronTheme";
import { ElectronWindow } from "../electron/ElectronWindow";
import { RuffleSocketProxy } from "../ruffle/RuffleSocketProxy";
import { DesktopSettings } from "../settings/DesktopSettings";
import { makeDesktopWindows } from "./DesktopWindows";

class TestContents extends EventEmitter {
  destroyed = false;
  closing = false;
  loads = 0;
  readonly sent: { channel: string; payload: unknown }[] = [];
  constructor(
    readonly id: number,
    readonly deferDestruction?: (destroy: () => void) => void,
  ) {
    super();
  }
  isDestroyed = () => this.destroyed;
  focus = () => this.emit("focus");
  getZoomFactor = () => 1;
  openDevTools = () => {};
  send = (channel: string, payload: unknown) => {
    this.sent.push({ channel, payload });
  };
  reload = () => {
    this.loads++;
    this.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false,
    });
    this.emit("did-start-loading");
  };
  reloadIgnoringCache = this.reload;
  close = () => {
    if (this.closing || this.destroyed) return;
    this.closing = true;
    const destroy = () => {
      this.destroyed = true;
      this.emit("destroyed");
    };
    if (this.deferDestruction === undefined) destroy();
    else this.deferDestruction(destroy);
  };
}

class TestWindow extends EventEmitter {
  destroyed = false;
  visible = false;
  title = "";
  readonly children = new Set<unknown>();
  readonly contentView = {
    addChildView: (view: unknown) => this.children.add(view),
    removeChildView: (view: unknown) => this.children.delete(view),
  };
  constructor(
    readonly id: number,
    readonly webContents?: TestContents,
  ) {
    super();
  }
  isDestroyed = () => this.destroyed;
  isFocused = () => true;
  isMinimized = () => false;
  isVisible = () => this.visible;
  focus = () => {};
  restore = () => {};
  show = () => {
    this.visible = true;
  };
  hide = () => {
    this.visible = false;
  };
  getContentBounds = () => ({ x: 0, y: 0, width: 1024, height: 798 });
  setBackgroundColor = () => {};
  setMenuBarVisibility = () => {};
  setTitle = (title: string) => {
    this.title = title;
  };
  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents?.close();
    this.emit("closed");
  };
  close = () => {
    let prevented = false;
    this.emit("close", {
      preventDefault: () => {
        prevented = true;
      },
    });
    if (!prevented) this.destroy();
  };
}

export const makeWindowHarness = Effect.fn(function* (
  options: {
    tabs?: boolean;
    platform?: NodeJS.Platform;
    gameLoad?: Effect.Effect<void>;
    beforeViewClose?: Effect.Effect<void>;
    deferDestruction?: boolean;
  } = {},
) {
  const appEvents = new EventEmitter();
  const nativeWindows: TestWindow[] = [];
  const contents: TestContents[] = [];
  const pendingDestructions: (() => void)[] = [];
  const released: string[] = [];
  const viewColors = new Map<number, string>();
  const viewBounds = new Map<
    number,
    { x: number; y: number; width: number; height: number }
  >();
  const faults = {
    viewBackground: false,
    viewBackgroundIds: new Set<number>(),
    viewClose: false,
    attach: false,
    reveal: false,
  };
  const activePartitions = new Set<string>();
  let nextId = 0;
  let quitCount = 0;
  const createContents = () => {
    const item = new TestContents(
      ++nextId,
      options.deferDestruction === true
        ? (destroy) => {
            pendingDestructions.push(destroy);
          }
        : undefined,
    );
    contents.push(item);
    return item;
  };
  const createWindow = (withRenderer: boolean) => {
    const item = new TestWindow(
      ++nextId,
      withRenderer ? createContents() : undefined,
    );
    const attach = item.contentView.addChildView;
    item.contentView.addChildView = (view) => {
      if (faults.attach) throw new Error("attachment failed");
      return attach(view);
    };
    nativeWindows.push(item);
    return item;
  };
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    preferences: {
      ...DEFAULT_APP_SETTINGS.preferences,
      useGameTabs: options.tabs ?? true,
    },
  };
  const windows = yield* makeDesktopWindows.pipe(
    Effect.provideService(DesktopEnvironment, {
      appDataDir: "/tmp/lucent-test",
      assetsDir: "/tmp/lucent-test",
      workspaceDir: "/tmp/lucent-test",
      isDev: false,
      platform: options.platform ?? "darwin",
    }),
    Effect.provideService(ElectronApp, {
      exit: () => Effect.void,
      getAppMetrics: Effect.succeed([]),
      getVersion: Effect.succeed("0"),
      on: (name, listener) =>
        Effect.sync(() => {
          appEvents.on(name, listener);
          return () => {
            appEvents.off(name, listener);
          };
        }),
      quit: Effect.sync(() => {
        quitCount++;
      }),
      relaunch: Effect.void,
      whenReady: Effect.void,
    }),
    Effect.provideService(ElectronWindow, {
      create: () =>
        Effect.acquireRelease(
          Effect.sync(() => createWindow(true)),
          (window) => Effect.sync(window.destroy),
        ) as unknown as ReturnType<ElectronWindow["Service"]["create"]>,
      createHost: () =>
        Effect.acquireRelease(
          Effect.sync(() => createWindow(false)),
          (window) => Effect.sync(window.destroy),
        ) as unknown as ReturnType<ElectronWindow["Service"]["createHost"]>,
      loadFile: (window, _path, loadOptions) =>
        Effect.sync(() => {
          contents.find((item) => item.id === window.webContents.id)!.reload();
        }).pipe(
          Effect.andThen(
            loadOptions?.query?.["socketProxy"] === undefined
              ? Effect.void
              : (options.gameLoad ?? Effect.void),
          ),
        ),
      reveal: (window) =>
        Effect.sync(() => {
          if (faults.reveal) throw new Error("reveal failed");
          window.show();
        }),
    }),
    Effect.provideService(ElectronGameView, {
      create: () =>
        Effect.acquireRelease(
          Effect.sync(() => {
            let bounds = { x: 0, y: 0, width: 0, height: 0 };
            const webContents = createContents();
            return {
              native: {},
              webContents,
              getBounds: () => bounds,
              setBounds: (next: typeof bounds) => {
                bounds = next;
                viewBounds.set(webContents.id, bounds);
              },
              setBackgroundColor: (color: string) => {
                if (
                  faults.viewBackground ||
                  faults.viewBackgroundIds.has(webContents.id)
                )
                  throw new Error("background failed");
                viewColors.set(webContents.id, color);
              },
            };
          }),
          (view) =>
            (options.beforeViewClose ?? Effect.void).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (faults.viewClose) throw new Error("view close failed");
                  view.webContents.close();
                }),
              ),
            ),
        ) as unknown as ReturnType<ElectronGameView["Service"]["create"]>,
      loadFile: (view, _path, loadOptions) =>
        Effect.sync(() => {
          contents.find((item) => item.id === view.webContents.id)!.reload();
        }).pipe(
          Effect.andThen(
            loadOptions?.query?.["socketProxy"] === undefined
              ? Effect.void
              : (options.gameLoad ?? Effect.void),
          ),
        ),
    }),
    Effect.provideService(ElectronSession, {
      acquireGamePartition: () =>
        Effect.sync(() => {
          const partition = `partition-${++nextId}`;
          activePartitions.add(partition);
          return partition;
        }),
      releaseGamePartition: (partition) => {
        released.push(partition);
        activePartitions.delete(partition);
      },
      prepareGameNetworking: Effect.void,
      clearAppData: Effect.void,
      retireManagedGameProfile: () => Effect.void,
    }),
    Effect.provideService(ElectronShell, {
      openExternal: () => Effect.succeed(true),
      openPath: () => Effect.succeed(true),
      showItemInFolder: () => Effect.void,
    }),
    Effect.provideService(ElectronTheme, {
      shouldUseDarkColors: Effect.succeed(false),
      setThemeMode: () => Effect.void,
    }),
    Effect.provideService(RuffleSocketProxy, {
      getUrl: Effect.succeed("ws://localhost:1"),
    }),
    Effect.provideService(DesktopSettings, {
      get: Effect.succeed(settings),
      load: Effect.succeed(settings),
      onChanged: () => Effect.succeed(() => {}),
      resetAppearance: Effect.succeed(settings),
      resetHotkeys: Effect.succeed(settings),
      updateAppearance: () => Effect.succeed(settings),
      updateHotkeys: () => Effect.succeed(settings),
      updatePreferences: () => Effect.succeed(settings),
    }),
  );
  return {
    windows,
    nativeWindows,
    contents,
    flushDestructions: () => {
      for (const destroy of pendingDestructions.splice(0)) destroy();
    },
    released,
    activePartitions,
    appEvents,
    viewBounds,
    viewColors,
    faults,
    quitCount: () => quitCount,
  };
});
