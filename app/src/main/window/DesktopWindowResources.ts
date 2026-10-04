import { join } from "path";
import type {
  WebContentsViewConstructorOptions,
  BrowserWindowConstructorOptions,
} from "electron";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import appBranding from "../../../appBranding.json";
import {
  GAME_VIEW_TAB_BAR_HEIGHT,
  type GameViewLayout,
} from "../../shared/gameViews";
import type { DesktopBridgeView } from "../../shared/desktopBridge";
import {
  type AppearanceSnapshot,
  createAppearanceSnapshot,
  serializeDesktopViewArgument,
  serializeAppearanceSnapshotArgument,
  serializeSettingsSnapshotArgument,
} from "../../shared/appearance";
import {
  DEBUG_MODE_ARGUMENT,
  GAME_CONSOLE_OBSERVABILITY_ARGUMENT,
  serializeGameViewLayoutArgument,
  TRACE_PROJECTIONS_ARGUMENT,
} from "../../shared/rendererBootstrapArguments";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@lucent/core/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import {
  ElectronGameView,
  type ElectronGameViewHandle,
} from "../electron/ElectronGameView";
import { ElectronSession } from "../electron/ElectronSession";
import { ElectronShell } from "../electron/ElectronShell";
import { ElectronTheme } from "../electron/ElectronTheme";
import {
  ElectronWindow,
  type ElectronWindowHandle,
  type ElectronWindowCreateOptions,
  type ElectronHostWindowCreateOptions,
} from "../electron/ElectronWindow";
import { RuffleSocketProxy } from "../ruffle/RuffleSocketProxy";
import { DesktopSettings } from "../settings/DesktopSettings";
import {
  getDesktopWindowDefinition,
  type DesktopWindowDefinition,
  type DesktopWindowKind,
} from "./DesktopWindowCatalog";
import type { DesktopWindowOpenOptions } from "./DesktopWindows";
import { parseAllowedGameWindowOpenUrl } from "./GameWindowOpenPolicy";

export interface WindowBootstrap {
  readonly settings: AppSettings;
  readonly appearance: AppearanceSnapshot;
}

const rendererRoot = join(__dirname, "../renderer");
const preloadPath = join(rendererRoot, "preload.js");

const viewHtmlPath = (kind: DesktopBridgeView): string =>
  join(rendererRoot, kind, "index.html");

type DesktopRendererWebPreferences = NonNullable<
  BrowserWindowConstructorOptions["webPreferences"]
>;

const createRendererWebPreferences = (
  env: DesktopEnvironment["Service"],
  bridgeView: DesktopBridgeView,
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
  options: {
    readonly backgroundThrottling?: boolean;
    readonly gameViewLayout?: GameViewLayout;
  } = {},
): DesktopRendererWebPreferences => ({
  additionalArguments: [
    serializeDesktopViewArgument(bridgeView),
    serializeAppearanceSnapshotArgument(snapshot),
    serializeSettingsSnapshotArgument(settings),
    ...(options.gameViewLayout === undefined
      ? []
      : [serializeGameViewLayoutArgument(options.gameViewLayout)]),
    ...(env.debug === true ? [DEBUG_MODE_ARGUMENT] : []),
    ...(bridgeView === "game" && env.debug === true
      ? [GAME_CONSOLE_OBSERVABILITY_ARGUMENT]
      : []),
    ...(bridgeView === "game" && env.traceProjections === true
      ? [TRACE_PROJECTIONS_ARGUMENT]
      : []),
  ],
  ...(options.backgroundThrottling === undefined
    ? {}
    : { backgroundThrottling: options.backgroundThrottling }),
  contextIsolation: true,
  nodeIntegration: false,
  preload: preloadPath,
  sandbox: false,
});

const createNativeWindowOptions = (
  env: DesktopEnvironment["Service"],
  definition: DesktopWindowDefinition,
  snapshot: AppearanceSnapshot,
): ElectronHostWindowCreateOptions => {
  const { height, width } = definition;
  const activeBranding = env.isDev ? appBranding.dev : appBranding.production;
  const appIconPath = join(env.assetsDir, activeBranding.iconPng);

  return {
    width,
    height,
    ...(definition.minWidth === undefined
      ? {}
      : { minWidth: Math.min(definition.minWidth, width) }),
    ...(definition.minHeight === undefined
      ? {}
      : { minHeight: Math.min(definition.minHeight, height) }),
    ...(definition.fixedSize === true
      ? {
          fullscreenable: false,
          maximizable: false,
          resizable: false,
          useContentSize: true,
        }
      : {}),
    ...(env.platform === "linux" ? { icon: appIconPath } : {}),
    ...(definition.kind === "game"
      ? { title: activeBranding.displayName }
      : {}),
    backgroundColor: snapshot.backgroundColor,
    show: false,
  };
};

const createWindowOptions = (
  env: DesktopEnvironment["Service"],
  definition: DesktopWindowDefinition,
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
  renderer?: {
    readonly bridgeView: DesktopBridgeView;
    readonly partition?: string;
  },
): ElectronWindowCreateOptions => {
  return {
    ...createNativeWindowOptions(env, definition, snapshot),
    webPreferences: {
      ...createRendererWebPreferences(
        env,
        renderer?.bridgeView ?? definition.kind,
        settings,
        snapshot,
        definition.kind === "game" ? { backgroundThrottling: false } : {},
      ),
      ...(renderer?.partition === undefined
        ? {}
        : { partition: renderer.partition }),
    },
  };
};

const gamePartitionOwner = (
  options?: DesktopWindowOpenOptions,
):
  | { readonly kind: "default" }
  | { readonly kind: "managed-account"; readonly key: string } =>
  options?.managedGameProfileKey === undefined
    ? { kind: "default" }
    : { kind: "managed-account", key: options.managedGameProfileKey };

const createGameViewOptions = (
  env: DesktopEnvironment["Service"],
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
  partition: string,
  layout: GameViewLayout,
): WebContentsViewConstructorOptions => ({
  webPreferences: {
    ...createRendererWebPreferences(env, "game", settings, snapshot, {
      backgroundThrottling: false,
      gameViewLayout: layout,
    }),
    partition,
  },
});

const createGameGroupControlsViewOptions = (
  env: DesktopEnvironment["Service"],
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
): WebContentsViewConstructorOptions => ({
  webPreferences: createRendererWebPreferences(
    env,
    "game-group-controls",
    settings,
    snapshot,
  ),
});

const createGameHostViewOptions = (
  env: DesktopEnvironment["Service"],
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
): WebContentsViewConstructorOptions => ({
  webPreferences: createRendererWebPreferences(
    env,
    "game-host",
    settings,
    snapshot,
  ),
});

export const makeDesktopWindowResources = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const settings = yield* DesktopSettings;
  const theme = yield* ElectronTheme;
  const windows = yield* ElectronWindow;
  const views = yield* ElectronGameView;
  const sessions = yield* ElectronSession;
  const shell = yield* ElectronShell;
  const socketProxy = yield* RuffleSocketProxy;
  const run = yield* FiberSet.makeRuntime();
  const readSettings = settings.get.pipe(
    Effect.catch((cause) =>
      Effect.logWarning(
        "Falling back to default settings for window bootstrap",
      ).pipe(
        Effect.annotateLogs({ component: "window", data: { cause } }),
        Effect.as(DEFAULT_APP_SETTINGS),
      ),
    ),
  );
  const bootstrap = Effect.gen(function* () {
    const current = yield* readSettings;
    const dark = yield* theme.shouldUseDarkColors;
    return {
      settings: current,
      appearance: createAppearanceSnapshot(current, dark),
    };
  });
  const openAllowedUrl = (raw: string): void => {
    const url = parseAllowedGameWindowOpenUrl(raw);
    if (url !== null)
      run(
        shell.openExternal(url).pipe(
          Effect.flatMap((opened) =>
            opened
              ? Effect.void
              : Effect.logWarning("Failed to open game URL").pipe(
                  Effect.annotateLogs({
                    component: "window",
                    data: { url: url.href },
                  }),
                ),
          ),
        ),
      );
  };
  const partition = (options?: DesktopWindowOpenOptions) =>
    Effect.acquireRelease(
      sessions.acquireGamePartition(gamePartitionOwner(options)),
      (value) => Effect.sync(() => sessions.releaseGamePartition(value)),
    );
  const browser = Effect.fn("DesktopWindowResources.browser")(function* (
    kind: DesktopWindowKind,
    input: WindowBootstrap,
    options?: DesktopWindowOpenOptions,
  ) {
    const gamePartition =
      kind === "game" ? yield* partition(options) : undefined;
    return yield* windows.create(
      createWindowOptions(
        env,
        getDesktopWindowDefinition(kind),
        input.settings,
        input.appearance,
        gamePartition === undefined
          ? undefined
          : { bridgeView: "game", partition: gamePartition },
      ),
      kind === "game" ? openAllowedUrl : undefined,
    );
  });
  const host = (input: WindowBootstrap) => {
    const definition = getDesktopWindowDefinition("game");
    return windows.createHost(
      createNativeWindowOptions(
        env,
        { ...definition, height: definition.height + GAME_VIEW_TAB_BAR_HEIGHT },
        input.appearance,
      ),
    );
  };
  const gameView = Effect.fn("DesktopWindowResources.gameView")(function* (
    input: WindowBootstrap,
    options?: DesktopWindowOpenOptions,
  ) {
    const gamePartition = yield* partition(options);
    const view = yield* views.create(
      createGameViewOptions(
        env,
        input.settings,
        input.appearance,
        gamePartition,
        options?.gameViewLayout ?? "focused",
      ),
      openAllowedUrl,
    );
    view.setBackgroundColor(input.appearance.backgroundColor);
    return view;
  });
  const hostView = Effect.fn("DesktopWindowResources.hostView")(function* (
    kind: "game-host" | "game-group-controls",
    input: WindowBootstrap,
  ) {
    const options =
      kind === "game-host"
        ? createGameHostViewOptions
        : createGameGroupControlsViewOptions;
    const view = yield* views.create(
      options(env, input.settings, input.appearance),
    );
    view.setBackgroundColor("#00000000");
    return view;
  });
  const debug = (contents: ElectronWindowHandle["webContents"]) =>
    env.debug === true
      ? Effect.try(() => contents.openDevTools({ mode: "detach" })).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to open renderer DevTools", cause),
          ),
        )
      : Effect.void;
  const loadBrowser = Effect.fn("DesktopWindowResources.loadBrowser")(
    function* (window: ElectronWindowHandle, kind: DesktopWindowKind) {
      const proxy = kind === "game" ? yield* socketProxy.getUrl : undefined;
      yield* windows.loadFile(
        window,
        viewHtmlPath(kind),
        proxy === undefined ? undefined : { query: { socketProxy: proxy } },
      );
      yield* debug(window.webContents);
    },
  );
  const loadView = Effect.fn("DesktopWindowResources.loadView")(function* (
    view: ElectronGameViewHandle,
    kind: "game" | "game-host" | "game-group-controls",
  ) {
    const proxy = kind === "game" ? yield* socketProxy.getUrl : undefined;
    yield* views.loadFile(
      view,
      viewHtmlPath(kind),
      proxy === undefined ? undefined : { query: { socketProxy: proxy } },
    );
    if (kind === "game") yield* debug(view.webContents);
  });
  return {
    bootstrap,
    readSettings,
    browser,
    host,
    gameView,
    hostView,
    loadBrowser,
    loadView,
    prepareGameNetworking: sessions.prepareGameNetworking,
    reveal: windows.reveal,
    retireManagedGameProfile: sessions.retireManagedGameProfile,
  };
});

export type DesktopWindowResources = Effect.Success<
  typeof makeDesktopWindowResources
>;
