import { join } from "path";

import {
  type WebContentsViewConstructorOptions,
  type BrowserWindowConstructorOptions,
  type Event as ElectronEvent,
  type RenderProcessGoneDetails,
  type WebContents,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import appBranding from "../../../appBranding.json";
import {
  GAME_VIEW_TAB_BAR_HEIGHT,
  MAX_GAME_VIEWS_PER_WINDOW,
  type GameViewHostState,
  type GameViewLayout,
  type GameViewPresentation,
  type GameViewSelectionFocus,
} from "../../shared/gameViews";
import { GameViewsIpc } from "../../shared/ipc";
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
import { makeListenerRegistry } from "../app/ListenerRegistry";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronGameView } from "../electron/ElectronGameView";
import { ElectronSession } from "../electron/ElectronSession";
import { ElectronShell } from "../electron/ElectronShell";
import { ElectronTheme } from "../electron/ElectronTheme";
import {
  ElectronWindow,
  isElectronWindowUsable,
  type ElectronWindowCreateOptions,
  type ElectronHostWindowCreateOptions,
  type ElectronWindowHandle,
  type ElectronNativeWindowHandle,
} from "../electron/ElectronWindow";
import { RuffleSocketProxy } from "../ruffle/RuffleSocketProxy";
import { DesktopSettings } from "../settings/DesktopSettings";
import {
  getDesktopWindowDefinition,
  type DesktopRendererKind,
  type DesktopWindowDefinition,
  type DesktopWindowKind,
} from "./DesktopWindowCatalog";
import {
  makeDesktopGameHosts,
  normalizeGameViewName,
  type DesktopGameHostRecord,
  type DesktopGameViewRecord,
} from "./DesktopGameHost";
import { parseAllowedGameWindowOpenUrl } from "./GameWindowOpenPolicy";
import { formatGameWindowTitle } from "./GameWindowTitle";
import {
  INITIAL_WINDOW_GENERATION,
  observeWindowReloads,
} from "./WindowGeneration";

export class DesktopWindowError extends Schema.TaggedError<DesktopWindowError>()(
  "DesktopWindowError",
  {
    id: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DesktopWindowsShape {
  readonly closeRenderer: (rendererId: number) => Effect.Effect<boolean>;
  readonly getRendererIds: (
    kind: DesktopWindowKind,
  ) => Effect.Effect<readonly number[]>;
  readonly getNativeWindowId: (
    rendererId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getRendererKind: (
    rendererId: number,
  ) => Effect.Effect<DesktopRendererKind | null>;
  readonly getOwnedRendererIds: (
    ownerRendererId: number,
    kind?: DesktopWindowKind,
  ) => Effect.Effect<readonly number[], DesktopWindowError>;
  readonly getOwnerRendererId: (
    rendererId: number,
  ) => Effect.Effect<number | null>;
  readonly getRendererGeneration: (
    rendererId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly isRendererReady: (rendererId: number) => Effect.Effect<boolean>;
  readonly markRendererReady: (
    rendererId: number,
    generation: number,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly addGameView: (
    hostRendererId: number,
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly closeGameView: (
    hostRendererId: number,
    id: number,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly getGameViewHostState: (
    hostRendererId: number,
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly getGameViewHostRendererId: (
    gameRendererId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getGameViewPresentation: (
    gameRendererId: number,
  ) => Effect.Effect<GameViewPresentation, DesktopWindowError>;
  readonly onClosed: (
    listener: (event: DesktopWindowClosedEvent) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onCreated: (
    listener: (
      event: DesktopWindowCreatedEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onRendererDestroyed: (
    listener: (
      event: DesktopWindowRendererDestroyedEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onRendererUnavailable: (
    listener: (
      event: DesktopWindowRendererUnavailableEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onRendererReloaded: (
    listener: (
      event: DesktopWindowRendererReloadedEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onRendererReady: (
    listener: (
      event: DesktopWindowRendererReadyEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly open: (
    kind: DesktopWindowKind,
    options?: DesktopWindowOpenOptions,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly revealRenderer: (rendererId: number) => Effect.Effect<boolean>;
  readonly reorderGameViews: (
    hostRendererId: number,
    ids: readonly number[],
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  /** Reloads the tab strip and selected client when they form one focused view. */
  readonly reloadFocusedGameContents: (
    nativeWindowId: number,
    focusedRendererId: number,
    bypassCache: boolean,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly selectGameView: (
    hostRendererId: number,
    id: number,
    focus: GameViewSelectionFocus,
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly setBackgroundColor: (backgroundColor: string) => Effect.Effect<void>;
  readonly setGameViewLayout: (
    hostRendererId: number,
    layout: GameViewLayout,
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly setGameViewGroupControlsOpen: (
    hostRendererId: number,
    open: boolean,
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly setGameViewGroupTargets: (
    hostRendererId: number,
    ids: readonly number[],
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly setGameViewName: (
    gameRendererId: number,
    name: string,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly setGameViewTabMenuOpen: (
    hostRendererId: number,
    open: boolean,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly syncGameViewTabBarLayout: (
    hostRendererId: number,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly withGameViewGroupControlsNativeDialog: <A, E, R>(
    hostRendererId: number,
    use: (parentWindowId: number) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, DesktopWindowError | E, R>;
}

export class DesktopWindows extends Context.Service<
  DesktopWindows,
  DesktopWindowsShape
>()("lucent/desktop/window/DesktopWindows") {}

export interface DesktopWindowOpenOptions {
  readonly gameHostTarget?: DesktopGameHostTarget;
  readonly gameViewLayout?: GameViewLayout;
  readonly gameViewName?: string;
  readonly managedGameProfileKey?: string;
  readonly onCreated?: (
    event: DesktopWindowCreatedEvent,
  ) => Effect.Effect<void, unknown>;
  readonly ownerRendererId?: number;
}

export type DesktopGameHostTarget =
  | { readonly kind: "available" }
  | { readonly kind: "game-view"; readonly rendererId: number }
  | { readonly kind: "new" };

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

interface DesktopRendererRecordBase {
  readonly rendererId: number;
  generation: number;
  readonly kind: DesktopWindowKind;
  // ownerId is logical ownership only; Electron parent windows are intentionally not used.
  readonly ownerId?: number;
  rendererReady: boolean;
  /** Rejects delayed readiness from a failed generation until navigation advances it. */
  unavailableGeneration?: number;
}

interface DesktopBrowserWindowRecord extends DesktopRendererRecordBase {
  readonly gamePartition?: string;
  readonly gameHostRendererId?: never;
  readonly gameView?: never;
  loggedInUsername?: string;
  publishedPresentation?: GameViewPresentation;
  readonly window: ElectronWindowHandle;
}

type DesktopRendererRecord = DesktopBrowserWindowRecord | DesktopGameViewRecord;

export interface DesktopWindowClosedEvent {
  readonly rendererId: number;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowCreatedEvent {
  readonly rendererId: number;
  readonly generation: number;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererDestroyedEvent {
  readonly rendererId: number;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererUnavailableFailure {
  readonly reason: RenderProcessGoneDetails["reason"];
  readonly type: "render-process-gone";
}

export interface DesktopWindowRendererUnavailableEvent {
  readonly failure: DesktopWindowRendererUnavailableFailure;
  readonly rendererId: number;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererReloadedEvent {
  readonly rendererId: number;
  readonly generation: number;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererReadyEvent {
  readonly rendererId: number;
  readonly generation: number;
  readonly kind: DesktopWindowKind;
}

const isGameViewRecord = (
  record: DesktopRendererRecord,
): record is DesktopGameViewRecord => record.gameView !== undefined;

const markRendererUnavailable = (record: DesktopRendererRecord): void => {
  record.rendererReady = false;
  record.unavailableGeneration = record.generation;
};

const beginRendererGeneration = (
  record: DesktopRendererRecord,
  generation: number,
): void => {
  record.generation = generation;
  record.rendererReady = false;
  delete record.unavailableGeneration;
};

/** Returns the native window containing a desktop renderer. */
const nativeWindowForRenderer = (
  record: DesktopRendererRecord,
): ElectronNativeWindowHandle =>
  isGameViewRecord(record) ? record.hostWindow : record.window;

const preventWindowClose = (event: unknown): void => {
  if (
    typeof event === "object" &&
    event !== null &&
    "preventDefault" in event &&
    typeof event.preventDefault === "function"
  ) {
    event.preventDefault();
  }
};

const standaloneGameViewPresentation = (
  window: ElectronWindowHandle,
): GameViewPresentation => ({
  active: true,
  layout: "focused",
  tiled: false,
  windowActive: window.isFocused(),
});

const publishStandaloneGameViewPresentation = (
  record: DesktopBrowserWindowRecord,
): void => {
  if (record.kind !== "game" || record.window.webContents.isDestroyed()) {
    return;
  }

  const presentation = standaloneGameViewPresentation(record.window);
  if (
    record.publishedPresentation?.active === presentation.active &&
    record.publishedPresentation.layout === presentation.layout &&
    record.publishedPresentation.tiled === presentation.tiled &&
    record.publishedPresentation.windowActive === presentation.windowActive
  ) {
    return;
  }
  record.publishedPresentation = presentation;
  record.window.webContents.send(
    GameViewsIpc.presentationChanged.channel,
    presentation,
  );
};

const makeDesktopWindows = Effect.gen(function* () {
  const socketProxy = yield* RuffleSocketProxy;
  const gameSocketRelayUrl = socketProxy.getUrl;
  const app = yield* ElectronApp;
  const env = yield* DesktopEnvironment;
  const electronGameView = yield* ElectronGameView;
  const electronWindow = yield* ElectronWindow;
  const electronSession = yield* ElectronSession;
  const electronShell = yield* ElectronShell;
  const settings = yield* DesktopSettings;
  const theme = yield* ElectronTheme;
  const run = yield* FiberSet.makeRuntime<never, void>();
  const activeBranding = env.isDev ? appBranding.dev : appBranding.production;
  const getBootstrapSettings = settings.get.pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Falling back to default settings for window bootstrap")
        .pipe(Effect.annotateLogs({ component: "window", data: { cause } }))
        .pipe(Effect.as(DEFAULT_APP_SETTINGS)),
    ),
  );
  const initialSettings = yield* getBootstrapSettings;
  let showGameUsernameInWindowTitle =
    initialSettings.preferences.showGameUsernameInWindowTitle;
  const renderers = new Map<number, DesktopRendererRecord>();
  const hiddenTopLevelWindowIds = new Set<number>();
  const setGameWindowTitle = (
    window: ElectronNativeWindowHandle,
    username: string | undefined,
  ): void => {
    if (!isElectronWindowUsable(window)) return;
    try {
      window.setTitle(
        formatGameWindowTitle(
          activeBranding.displayName,
          showGameUsernameInWindowTitle,
          username,
        ),
      );
    } catch {}
  };
  const refreshGameHostWindowTitle = (host: DesktopGameHostRecord): void => {
    const selected = renderers.get(host.selectedId);
    setGameWindowTitle(
      host.window,
      selected !== undefined && isGameViewRecord(selected)
        ? selected.loggedInUsername
        : undefined,
    );
  };
  const refreshStandaloneGameWindowTitle = (
    record: DesktopBrowserWindowRecord,
  ): void => setGameWindowTitle(record.window, record.loggedInUsername);
  const gameHosts = makeDesktopGameHosts({
    getGameViewRecord: (id) => {
      const record = renderers.get(id);
      return record !== undefined && isGameViewRecord(record)
        ? record
        : undefined;
    },
    onShortcutError: ({ cause, hostRendererId, id }) => {
      run(
        Effect.logWarning("Failed to use game view shortcut").pipe(
          Effect.annotateLogs({
            component: "window",
            data: {
              cause,
              hostRendererId,
              id,
            },
          }),
        ),
      );
    },
    onStateChanged: refreshGameHostWindowTitle,
    platform: env.platform,
  });
  const unsubscribeWindowTitleSettings = yield* settings.onChanged(
    (nextSettings) => {
      const nextValue = nextSettings.preferences.showGameUsernameInWindowTitle;
      if (showGameUsernameInWindowTitle === nextValue) return;
      showGameUsernameInWindowTitle = nextValue;
      for (const host of gameHosts.values()) {
        refreshGameHostWindowTitle(host);
      }
      for (const record of renderers.values()) {
        if (record.kind === "game" && !isGameViewRecord(record)) {
          refreshStandaloneGameWindowTitle(record);
        }
      }
    },
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeWindowTitleSettings));
  const createdEvents = makeListenerRegistry<DesktopWindowCreatedEvent>();
  const closedEvents = makeListenerRegistry<DesktopWindowClosedEvent>({
    concurrency: "unbounded",
  });
  const rendererDestroyedEvents =
    makeListenerRegistry<DesktopWindowRendererDestroyedEvent>({
      concurrency: "unbounded",
    });
  const rendererUnavailableEvents =
    makeListenerRegistry<DesktopWindowRendererUnavailableEvent>({
      concurrency: "unbounded",
    });
  const rendererReloadedEvents =
    makeListenerRegistry<DesktopWindowRendererReloadedEvent>({
      concurrency: "unbounded",
    });
  const rendererReadyEvents =
    makeListenerRegistry<DesktopWindowRendererReadyEvent>();

  const observeRendererAvailability = (
    contents: Pick<WebContents, "off" | "on">,
    event: Omit<DesktopWindowRendererUnavailableEvent, "failure">,
    onUnavailable: (failure: DesktopWindowRendererUnavailableFailure) => void,
  ): (() => void) => {
    const publish = (
      failure: DesktopWindowRendererUnavailableFailure,
    ): void => {
      onUnavailable(failure);
      const unavailableEvent = { ...event, failure };
      run(rendererUnavailableEvents.publish(unavailableEvent));
    };
    const handleRenderProcessGone = (
      _event: ElectronEvent,
      details: RenderProcessGoneDetails,
    ): void =>
      publish({
        reason: details.reason,
        type: "render-process-gone",
      });

    contents.on("render-process-gone", handleRenderProcessGone);
    return () => {
      contents.off("render-process-gone", handleRenderProcessGone);
    };
  };

  const forgetUnusableWindowRecord = (
    id: number,
    record: DesktopRendererRecord,
  ): void => {
    // Hosted game views are removed by their host lifecycle so it can still
    // publish one close event per session after Electron destroys renderers.
    if (!isGameViewRecord(record)) {
      renderers.delete(id);
      hiddenTopLevelWindowIds.delete(id);
    }
  };
  let appIsQuitting = false;
  let hasOpenedTopLevelWindow = false;
  let quitRequested = false;
  // An in-flight top-level open is recoverable UI during a concurrent close.
  let openingTopLevelWindowCount = 0;

  const forgetWindow = (id: number): void => {
    renderers.delete(id);
    hiddenTopLevelWindowIds.delete(id);
  };

  const openAllowedGameUrl = (rawUrl: string): void => {
    const url = parseAllowedGameWindowOpenUrl(rawUrl);
    if (url === null) {
      return;
    }

    run(
      electronShell.openExternal(url).pipe(
        Effect.flatMap((opened) =>
          opened
            ? Effect.void
            : Effect.logWarning("Failed to open game URL").pipe(
                Effect.annotateLogs({
                  component: "window",
                  data: {
                    url,
                  },
                }),
              ),
        ),
      ),
    );
  };

  const unsubscribeBeforeQuit = yield* app.on("before-quit", () => {
    appIsQuitting = true;
  });
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeBeforeQuit));

  const hasPresentableTopLevelWindow = (): boolean =>
    [...renderers.entries()].some(
      ([id, record]) =>
        getDesktopWindowDefinition(record.kind).scope !== "game-child" &&
        !hiddenTopLevelWindowIds.has(id) &&
        isElectronWindowUsable(nativeWindowForRenderer(record)),
    );

  const quitIfNoTopLevelWindow = (): void => {
    if (
      env.platform === "darwin" ||
      appIsQuitting ||
      quitRequested ||
      openingTopLevelWindowCount > 0 ||
      hasPresentableTopLevelWindow()
    ) {
      return;
    }

    quitRequested = true;
    run(
      app.quit.pipe(
        Effect.catchCause(() =>
          Effect.sync(() => {
            quitRequested = false;
          }),
        ),
      ),
    );
  };

  const destroyFailedWindow = Effect.fn("DesktopWindows.destroyFailedWindow")(
    function* (id: number, kind: DesktopWindowKind) {
      yield* Effect.try({
        try: () => {
          const record = renderers.get(id);
          if (record === undefined) {
            return;
          }

          const nativeWindow = nativeWindowForRenderer(record);
          if (nativeWindow.isDestroyed()) {
            forgetWindow(id);
            return;
          }

          // A failed launch into an existing host owns only the new view.
          // Destroying its BrowserWindow would also close healthy siblings.
          if (isGameViewRecord(record)) {
            closeGameViewRecord(id, record);
            return;
          }

          nativeWindow.destroy();
        },
        catch: (cause) => {
          forgetWindow(id);
          return new DesktopWindowError({
            id: String(id),
            detail: `Failed to destroy incomplete desktop window: ${kind}`,
            cause,
          });
        },
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Failed to destroy incomplete desktop window").pipe(
            Effect.annotateLogs({
              component: "window",
              data: { cause, id, kind },
            }),
          ),
        ),
      );
    },
  );

  const revealExisting = (id: number) => {
    const record = renderers.get(id);
    if (record === undefined) {
      forgetWindow(id);
      return Effect.succeed(false);
    }
    const nativeWindow = nativeWindowForRenderer(record);
    if (!isElectronWindowUsable(nativeWindow)) {
      forgetUnusableWindowRecord(id, record);
      return Effect.succeed(false);
    }

    if (isGameViewRecord(record)) {
      const host = gameHosts.find(record.gameHostRendererId);
      if (host === null) {
        return Effect.succeed(false);
      }
      gameHosts.focus(host, id);
    }

    return electronWindow.reveal(nativeWindow).pipe(
      Effect.andThen(
        Effect.sync(() => {
          hiddenTopLevelWindowIds.delete(id);
        }),
      ),
      Effect.as(true),
    );
  };

  const findRenderer = (rendererId: number): DesktopRendererRecord | null => {
    const record = renderers.get(rendererId);
    if (record === undefined) return null;
    if (
      isElectronWindowUsable(nativeWindowForRenderer(record)) &&
      (!isGameViewRecord(record) || !record.gameView.webContents.isDestroyed())
    ) {
      return record;
    }
    forgetUnusableWindowRecord(rendererId, record);
    return null;
  };

  const findGameHostForView = (
    rendererId: number,
  ): DesktopGameHostRecord | null => {
    const record = findRenderer(rendererId);
    if (record === null || !isGameViewRecord(record)) {
      return null;
    }
    return gameHosts.find(record.gameHostRendererId);
  };

  const findGameHostForNativeWindow = (
    nativeWindowId: number,
  ): DesktopGameHostRecord | null => {
    for (const candidate of gameHosts.values()) {
      const host = gameHosts.find(candidate.rendererId);
      if (host !== null && host.window.id === nativeWindowId) {
        return host;
      }
    }
    return null;
  };

  const reloadFocusedGameContents: DesktopWindowsShape["reloadFocusedGameContents"] =
    (nativeWindowId, focusedRendererId, bypassCache) =>
      Effect.try({
        try: () => {
          const host = findGameHostForNativeWindow(nativeWindowId);
          if (host === null || host.layout !== "focused") {
            return false;
          }

          const selected = renderers.get(host.selectedId);
          if (
            selected === undefined ||
            !isGameViewRecord(selected) ||
            selected.gameHostRendererId !== host.rendererId ||
            (focusedRendererId !== host.rendererId &&
              focusedRendererId !== selected.rendererId)
          ) {
            return false;
          }

          // The tab strip and selected Flash client are separate renderers but
          // present as one focused view.
          const targets = [
            host.hostView.webContents,
            selected.gameView.webContents,
          ];
          for (const target of targets) {
            if (bypassCache) {
              target.reloadIgnoringCache();
            } else {
              target.reload();
            }
          }
          return true;
        },
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: "Failed to reload the focused game view.",
            id: String(nativeWindowId),
          }),
      });

  const getNativeWindowId: DesktopWindowsShape["getNativeWindowId"] = (
    rendererId,
  ) =>
    Effect.try({
      try: () => {
        const host = gameHosts.find(rendererId);
        if (host !== null) return host.window.id;
        const record = findRenderer(rendererId);
        if (record === null) {
          throw new Error(`Desktop renderer is not open: ${rendererId}`);
        }
        return nativeWindowForRenderer(record).id;
      },
      catch: (cause) =>
        new DesktopWindowError({
          cause,
          detail: `Failed to resolve native window: ${rendererId}`,
          id: String(rendererId),
        }),
    });

  const getRendererIds: DesktopWindowsShape["getRendererIds"] = (kind) =>
    Effect.sync(() =>
      [...renderers.values()]
        .filter(
          (record) =>
            record.kind === kind &&
            isElectronWindowUsable(nativeWindowForRenderer(record)) &&
            (!isGameViewRecord(record) ||
              !record.gameView.webContents.isDestroyed()),
        )
        .map((record) => record.rendererId),
    );

  const getRendererKind: DesktopWindowsShape["getRendererKind"] = (
    rendererId,
  ) =>
    Effect.sync(() => {
      const record = findRenderer(rendererId);
      if (record !== null) {
        return record.kind;
      }
      if (
        gameHosts.hasGroupControlsRenderer(rendererId) &&
        gameHosts.find(rendererId) !== null
      ) {
        return "game-group-controls";
      }
      return gameHosts.find(rendererId) === null ? null : "game-host";
    });

  const getOwnerRendererId: DesktopWindowsShape["getOwnerRendererId"] = (
    rendererId,
  ) =>
    Effect.sync(() => {
      const record = findRenderer(rendererId);
      if (record === null) {
        return null;
      }

      const ownerId = record.ownerId;
      if (ownerId === undefined) {
        return null;
      }

      const owner = renderers.get(ownerId);
      return owner === undefined ||
        !isElectronWindowUsable(nativeWindowForRenderer(owner))
        ? null
        : owner.rendererId;
    });

  const isRendererReady: DesktopWindowsShape["isRendererReady"] = (
    rendererId,
  ) =>
    Effect.sync(() => {
      const record = findRenderer(rendererId);
      return record !== null && record.rendererReady;
    });

  const getRendererGeneration: DesktopWindowsShape["getRendererGeneration"] = (
    rendererId,
  ) =>
    Effect.try({
      try: () => {
        const record = findRenderer(rendererId);
        if (record === null) {
          throw new Error(`Desktop window is not open: ${rendererId}`);
        }
        return record.generation;
      },
      catch: (cause) =>
        new DesktopWindowError({
          id: String(rendererId),
          detail: `Failed to read renderer generation: ${rendererId}`,
          cause,
        }),
    });

  const markRendererReady: DesktopWindowsShape["markRendererReady"] = (
    rendererId,
    generation,
  ) =>
    Effect.gen(function* () {
      const readyEvent = yield* Effect.try({
        try: () => {
          const record = findRenderer(rendererId);
          if (record === null) {
            throw new Error(`Desktop window is not open: ${rendererId}`);
          }

          if (record.generation !== generation) {
            throw new Error(
              `Renderer generation ${generation} is stale; current generation is ${record.generation}.`,
            );
          }
          if (record.unavailableGeneration === generation) {
            throw new Error(
              `Renderer generation ${generation} is unavailable.`,
            );
          }
          if (record.rendererReady) {
            return null;
          }

          record.rendererReady = true;
          if (isGameViewRecord(record)) {
            record.gameViewPhase = "ready";
            delete record.gameViewError;
            const host = gameHosts.find(record.gameHostRendererId);
            if (host !== null) {
              gameHosts.publishState(host);
            }
          }
          return {
            rendererId,
            generation: record.generation,
            kind: record.kind,
          } satisfies DesktopWindowRendererReadyEvent;
        },
        catch: (cause) =>
          new DesktopWindowError({
            id: String(rendererId),
            detail: `Failed to mark renderer ready: ${rendererId}`,
            cause,
          }),
      });

      if (readyEvent === null) {
        return;
      }

      yield* rendererReadyEvents.publish(readyEvent);
    });

  const getOwnedRendererIds: DesktopWindowsShape["getOwnedRendererIds"] = (
    ownerRendererId,
    kind,
  ) =>
    Effect.try({
      try: () => {
        const owner = findRenderer(ownerRendererId);
        if (owner === null) {
          throw new Error(
            `Desktop window owner is not open: ${ownerRendererId}`,
          );
        }

        const ownerId = owner.rendererId;
        return [...renderers.values()]
          .filter(
            (record) =>
              record.ownerId === ownerId &&
              (kind === undefined || record.kind === kind) &&
              isElectronWindowUsable(nativeWindowForRenderer(record)),
          )
          .map((record) => record.rendererId);
      },
      catch: (cause) =>
        new DesktopWindowError({
          id: String(ownerRendererId),
          detail: `Failed to resolve owned Electron windows: ${ownerRendererId}`,
          cause,
        }),
    });

  const destroyOwnedWindows = (ownerId: number): void => {
    for (const record of renderers.values()) {
      const nativeWindow = nativeWindowForRenderer(record);
      if (record.ownerId === ownerId && isElectronWindowUsable(nativeWindow)) {
        nativeWindow.destroy();
      }
    }
  };

  const publishClosed = (record: DesktopRendererRecord): void => {
    const event: DesktopWindowClosedEvent = {
      rendererId: record.rendererId,
      kind: record.kind,
    };
    run(closedEvents.publish(event));
  };

  const closeGameViewRecord = (
    id: number,
    record: DesktopGameViewRecord,
  ): void => {
    const host = gameHosts.find(record.gameHostRendererId);
    const removedIndex = host?.orderedIds.indexOf(id) ?? -1;

    renderers.delete(id);
    record.stopObservingFocus();
    record.stopObservingReloads();
    record.stopObservingShortcutInput();
    destroyOwnedWindows(id);

    if (host !== null && isElectronWindowUsable(host.window)) {
      try {
        host.window.contentView.removeChildView(record.gameView.native);
      } catch {}
    }
    electronGameView.destroy(record.gameView);
    electronSession.releaseGamePartition(record.gamePartition);
    publishClosed(record);

    if (host === null || removedIndex < 0) {
      return;
    }

    host.orderedIds.splice(removedIndex, 1);
    host.groupTargetIds.delete(id);
    if (host.stackedGameViewId === id) {
      delete host.stackedGameViewId;
    }
    if (host.orderedIds.length === 0) {
      host.closing = true;
      host.window.close();
      return;
    }

    if (host.orderedIds.length === 1) {
      host.layout = "focused";
    }

    if (host.selectedId === id) {
      host.selectedId =
        host.orderedIds[Math.min(removedIndex, host.orderedIds.length - 1)]!;
    }
    gameHosts.refresh(host);
  };

  const revealRenderer: DesktopWindowsShape["revealRenderer"] = (rendererId) =>
    Effect.gen(function* () {
      const record = findRenderer(rendererId);
      if (record === null) {
        return false;
      }

      return yield* revealExisting(record.rendererId);
    });

  const closeRenderer: DesktopWindowsShape["closeRenderer"] = (rendererId) =>
    Effect.sync(() => {
      const record = findRenderer(rendererId);
      if (record === null) {
        return false;
      }

      if (isGameViewRecord(record)) {
        closeGameViewRecord(record.rendererId, record);
        return true;
      }
      record.window.close();
      return true;
    });

  const setBackgroundColor: DesktopWindowsShape["setBackgroundColor"] = (
    backgroundColor,
  ) =>
    Effect.forEach(
      renderers.entries(),
      ([id, record]) => {
        const nativeWindow = nativeWindowForRenderer(record);
        if (!isElectronWindowUsable(nativeWindow)) {
          forgetUnusableWindowRecord(id, record);
          return Effect.void;
        }

        return Effect.try({
          try: () => {
            nativeWindow.setBackgroundColor(backgroundColor);
            if (isGameViewRecord(record)) {
              record.gameView.setBackgroundColor(backgroundColor);
            }
          },
          catch: (cause) =>
            new DesktopWindowError({
              id: String(id),
              detail: `Failed to update desktop window background: ${id}`,
              cause,
            }),
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning(
              "Failed to update desktop window background",
            ).pipe(
              Effect.annotateLogs({ component: "window", data: { cause, id } }),
            ),
          ),
        );
      },
      { discard: true },
    );

  const findOpenInstance = (
    kind: DesktopWindowKind,
    ownerId: number | undefined,
  ): DesktopRendererRecord | null => {
    for (const record of renderers.values()) {
      if (
        record.kind === kind &&
        record.ownerId === ownerId &&
        isElectronWindowUsable(nativeWindowForRenderer(record))
      ) {
        return record;
      }
    }
    return null;
  };

  const updateGameViewPhase = (
    id: number,
    phase: DesktopGameViewRecord["gameViewPhase"],
    error?: string,
  ): void => {
    const record = renderers.get(id);
    if (record === undefined || !isGameViewRecord(record)) {
      return;
    }

    if (record.gameViewPhase === phase && record.gameViewError === error) {
      return;
    }

    record.gameViewPhase = phase;
    if (error === undefined) {
      delete record.gameViewError;
    } else {
      record.gameViewError = error;
    }
    const host = gameHosts.find(record.gameHostRendererId);
    if (host !== null) {
      gameHosts.publishState(host);
    }
  };

  const createGameViewInHost = Effect.fn("DesktopWindows.createGameViewInHost")(
    function* (
      host: DesktopGameHostRecord,
      onRegistered: (rendererId: number) => void,
      bootstrapSettings: AppSettings,
      snapshot: AppearanceSnapshot,
      options?: DesktopWindowOpenOptions,
    ) {
      if (host.orderedIds.length >= MAX_GAME_VIEWS_PER_WINDOW) {
        return yield* new DesktopWindowError({
          id: String(host.rendererId),
          detail: `This game window already has ${MAX_GAME_VIEWS_PER_WINDOW} views.`,
        });
      }

      const layout = options?.gameViewLayout ?? "focused";
      const gamePartition = yield* electronSession
        .acquireGamePartition(gamePartitionOwner(options))
        .pipe(
          Effect.mapError(
            (cause) =>
              new DesktopWindowError({
                cause,
                detail: "Failed to prepare an isolated Flash session.",
                id: String(host.rendererId),
              }),
          ),
        );
      const view = yield* electronGameView
        .create(
          createGameViewOptions(
            env,
            bootstrapSettings,
            snapshot,
            gamePartition,
            layout,
          ),
          openAllowedGameUrl,
        )
        .pipe(
          Effect.tapError(() =>
            Effect.sync(() =>
              electronSession.releaseGamePartition(gamePartition),
            ),
          ),
        );
      view.setBackgroundColor(snapshot.backgroundColor);

      yield* Effect.try({
        try: () => host.window.contentView.addChildView(view.native),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: "Failed to attach a game view to its host window.",
            id: String(view.webContents.id),
          }),
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            electronGameView.destroy(view);
            electronSession.releaseGamePartition(gamePartition);
          }),
        ),
      );

      const rendererId = view.webContents.id;
      const gameViewName = normalizeGameViewName(options?.gameViewName);
      const record: DesktopGameViewRecord = {
        boundsLayout: layout,
        rendererId,
        gameHostRendererId: host.rendererId,
        gamePartition,
        gameView: view,
        ...(gameViewName === undefined ? {} : { gameViewName }),
        gameViewPhase: "preparing",
        generation: INITIAL_WINDOW_GENERATION,
        kind: "game",
        rendererReady: false,
        stopObservingFocus: () => {},
        stopObservingReloads: () => {},
        stopObservingShortcutInput: () => {},
        hostWindow: host.window,
      };
      // New tabs follow an existing select-all state, but stay excluded from a
      // user-chosen subset.
      const allViewsTargeted =
        host.groupTargetIds.size === host.orderedIds.length;
      renderers.set(rendererId, record);
      onRegistered(rendererId);
      host.orderedIds.push(rendererId);
      if (allViewsTargeted) {
        host.groupTargetIds.add(rendererId);
      }
      host.selectedId = rendererId;
      host.layout = layout;
      if (host.orderedIds.length === 1) gameHosts.register(host);

      const createdEvent: DesktopWindowCreatedEvent = {
        rendererId,
        generation: INITIAL_WINDOW_GENERATION,
        kind: "game",
      };
      const rendererDestroyedEvent: DesktopWindowRendererDestroyedEvent = {
        rendererId,
        kind: "game",
      };
      const stopObservingAvailability = observeRendererAvailability(
        view.webContents,
        rendererDestroyedEvent,
        () => {
          markRendererUnavailable(record);
          updateGameViewPhase(
            rendererId,
            "error",
            "The game stopped unexpectedly.",
          );
        },
      );
      record.stopObservingReloads = observeWindowReloads(
        view.webContents,
        (generation) => {
          beginRendererGeneration(record, generation);
          updateGameViewPhase(rendererId, "loading");
          const reloadedEvent: DesktopWindowRendererReloadedEvent = {
            rendererId,
            generation,
            kind: "game",
          };
          run(rendererReloadedEvents.publish(reloadedEvent));
        },
      );
      const shortcutInputListener = gameHosts.makeShortcutInputListener(host);
      view.webContents.on("before-input-event", shortcutInputListener);
      let observingShortcutInput = true;
      record.stopObservingShortcutInput = () => {
        if (!observingShortcutInput) {
          return;
        }
        observingShortcutInput = false;
        if (view.webContents.isDestroyed()) {
          return;
        }
        view.webContents.removeListener(
          "before-input-event",
          shortcutInputListener,
        );
      };

      view.webContents.on("did-start-loading", () => {
        record.rendererReady = false;
        updateGameViewPhase(rendererId, "loading");
      });
      record.stopObservingFocus = electronGameView.onFocus(view, () => {
        gameHosts.activate(host, rendererId);
        if (host.groupControlsOpen && !host.groupControlsNativeDialogOpen) {
          gameHosts.setGroupControlsOpen(host, false);
        }
      });
      view.webContents.on(
        "did-fail-load",
        (_event, _errorCode, errorDescription, _validatedUrl, isMainFrame) => {
          if (isMainFrame === false) {
            return;
          }
          updateGameViewPhase(rendererId, "error", errorDescription);
        },
      );
      view.webContents.on("destroyed", () => {
        markRendererUnavailable(record);
        stopObservingAvailability();
        record.stopObservingFocus();
        record.stopObservingReloads();
        record.stopObservingShortcutInput();
        run(rendererDestroyedEvents.publish(rendererDestroyedEvent));
      });

      yield* createdEvents.publish(createdEvent);
      if (options?.onCreated !== undefined) {
        yield* options
          .onCreated(createdEvent)
          .pipe(
            Effect.tapError(() =>
              Effect.sync(() => closeGameViewRecord(rendererId, record)),
            ),
          );
      }

      gameHosts.refresh(host);
      run(
        gameSocketRelayUrl.pipe(
          Effect.flatMap((socketProxy) =>
            electronGameView.loadFile(view, viewHtmlPath("game"), {
              query: { socketProxy },
            }),
          ),
          Effect.catch((cause) =>
            Effect.sync(() => {
              updateGameViewPhase(rendererId, "error", cause.message);
            }),
          ),
        ),
      );

      if (env.debug === true) {
        yield* Effect.try({
          try: () => view.webContents.openDevTools({ mode: "detach" }),
          catch: (cause) =>
            new DesktopWindowError({
              cause,
              detail: `Failed to open game view DevTools: ${rendererId}`,
              id: String(rendererId),
            }),
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Failed to open game view DevTools").pipe(
              Effect.annotateLogs({
                component: "window",
                data: {
                  cause,
                  rendererId,
                },
              }),
            ),
          ),
        );
      }
      return rendererId;
    },
  );

  const createMultiGameWindow = Effect.fn(
    "DesktopWindows.createMultiGameWindow",
  )(function* (
    onRegistered: (rendererId: number) => void,
    definition: DesktopWindowDefinition,
    bootstrapSettings: AppSettings,
    snapshot: AppearanceSnapshot,
    options?: DesktopWindowOpenOptions,
  ) {
    const window = yield* electronWindow.createHost(
      createNativeWindowOptions(
        env,
        { ...definition, height: definition.height + GAME_VIEW_TAB_BAR_HEIGHT },
        snapshot,
      ),
    );
    const groupControlsView = yield* electronGameView
      .create(
        createGameGroupControlsViewOptions(env, bootstrapSettings, snapshot),
      )
      .pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            if (isElectronWindowUsable(window)) window.destroy();
          }),
        ),
      );
    groupControlsView.setBackgroundColor("#00000000");
    // The tabs and their overflow menu share one persistent view that expands on demand.
    const hostView = yield* electronGameView
      .create(createGameHostViewOptions(env, bootstrapSettings, snapshot))
      .pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            electronGameView.destroy(groupControlsView);
            if (isElectronWindowUsable(window)) window.destroy();
          }),
        ),
      );
    hostView.setBackgroundColor("#00000000");
    yield* Effect.try({
      try: () => window.contentView.addChildView(hostView.native),
      catch: (cause) =>
        new DesktopWindowError({
          cause,
          detail: "Failed to attach the game host view.",
          id: String(hostView.webContents.id),
        }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          electronGameView.destroy(hostView);
          electronGameView.destroy(groupControlsView);
          if (isElectronWindowUsable(window)) window.destroy();
        }),
      ),
    );
    const hostWebContents = hostView.webContents;
    const host: DesktopGameHostRecord = {
      closing: false,
      groupControlsNativeDialogOpen: false,
      groupControlsOpen: false,
      groupControlsView,
      groupTargetIds: new Set(),
      hostView,
      layout: "focused",
      orderedIds: [],
      rendererId: hostWebContents.id,
      selectedId: Number.NaN,
      shortcutModifierPressed: false,
      stopObservingShortcutInput: () => {},
      tabMenuOpen: false,
      window,
    };
    hostWebContents.once("destroyed", () => {
      gameHosts.unregister(host);
    });
    groupControlsView.webContents.once("destroyed", () => {
      gameHosts.unregister(host);
    });
    const shortcutInputListener = gameHosts.makeShortcutInputListener(host);
    hostWebContents.on("before-input-event", shortcutInputListener);
    let observingShortcutInput = true;
    host.stopObservingShortcutInput = () => {
      if (!observingShortcutInput) {
        return;
      }
      observingShortcutInput = false;
      // Electron can invalidate native accessors before emitting "closed".
      try {
        if (!hostWebContents.isDestroyed()) {
          hostWebContents.off("before-input-event", shortcutInputListener);
        }
      } catch {}
    };

    hostWebContents.on("did-start-loading", () => {
      if (!host.tabMenuOpen) return;
      try {
        gameHosts.setTabMenuOpen(host, false);
      } catch {}
    });
    window.on("resize", () => {
      if (host.orderedIds.length === 0) return;
      if (host.tabMenuOpen) {
        try {
          gameHosts.setTabMenuOpen(host, false);
        } catch {}
      }
      gameHosts.scheduleResize(host);
    });
    window.on("resized", () => {
      if (host.orderedIds.length > 0) gameHosts.finishResize(host);
    });
    window.on("focus", () => gameHosts.publishPresentations(host));
    window.on("blur", () => {
      gameHosts.publishPresentations(host);
      gameHosts.setShortcutModifierPressed(host, false);
      // A parented native file picker temporarily blurs its host window.
      if (host.groupControlsOpen && !host.groupControlsNativeDialogOpen) {
        try {
          gameHosts.setGroupControlsOpen(host, false);
        } catch {}
      }
      if (host.tabMenuOpen) {
        try {
          gameHosts.setTabMenuOpen(host, false);
        } catch {}
      }
    });
    window.once("closed", () => {
      host.closing = true;
      host.stopObservingShortcutInput();
      gameHosts.cancelResize(host);
      gameHosts.unregister(host);

      const closingGameViews = host.orderedIds.flatMap((gameViewId) => {
        const record = renderers.get(gameViewId);
        return record !== undefined && isGameViewRecord(record)
          ? [[gameViewId, record] as const]
          : [];
      });
      for (const [gameViewId] of closingGameViews) {
        renderers.delete(gameViewId);
      }
      host.orderedIds.splice(0);
      for (const [gameViewId, record] of closingGameViews) {
        try {
          record.stopObservingFocus();
          record.stopObservingReloads();
          record.stopObservingShortcutInput();
          destroyOwnedWindows(gameViewId);
          electronGameView.destroy(record.gameView);
        } catch (cause) {
          run(
            Effect.logWarning("Failed to clean up game view").pipe(
              Effect.annotateLogs({
                component: "window",
                data: {
                  cause,
                  gameViewId,
                  hostRendererId: host.rendererId,
                },
              }),
            ),
          );
        } finally {
          electronSession.releaseGamePartition(record.gamePartition);
        }
        publishClosed(record);
      }
      try {
        electronGameView.destroy(groupControlsView);
      } catch (cause) {
        run(
          Effect.logWarning("Failed to clean up group controls").pipe(
            Effect.annotateLogs({
              component: "window",
              data: {
                cause,
                hostRendererId: host.rendererId,
              },
            }),
          ),
        );
      }
      try {
        electronGameView.destroy(hostView);
      } catch (cause) {
        run(
          Effect.logWarning("Failed to clean up game host").pipe(
            Effect.annotateLogs({
              component: "window",
              data: {
                cause,
                hostRendererId: host.rendererId,
              },
            }),
          ),
        );
      }

      quitIfNoTopLevelWindow();
    });

    return yield* Effect.gen(function* () {
      const id = yield* createGameViewInHost(
        host,
        onRegistered,
        bootstrapSettings,
        snapshot,
        options,
      );
      yield* Effect.all(
        [
          electronGameView.loadFile(
            groupControlsView,
            viewHtmlPath("game-group-controls"),
          ),
          electronGameView.loadFile(hostView, viewHtmlPath("game-host")),
        ],
        { concurrency: "unbounded", discard: true },
      );
      yield* electronWindow.reveal(window);
      const initialGameView = renderers.get(id);
      if (
        initialGameView !== undefined &&
        isGameViewRecord(initialGameView) &&
        !initialGameView.gameView.webContents.isDestroyed()
      ) {
        // Revealing the window can focus the host's first button and open its
        // tooltip. Start interaction in the game without changing the layout.
        initialGameView.gameView.webContents.focus();
      }
      hasOpenedTopLevelWindow = true;
      yield* Effect.logInfo("Multi-game window opened").pipe(
        Effect.annotateLogs({
          component: "window",
          data: {
            hostRendererId: host.rendererId,
            id,
          },
        }),
      );
      return id;
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (isElectronWindowUsable(window)) {
            window.destroy();
          }
        }),
      ),
    );
  });

  const requireGameHost = (
    hostRendererId: number,
  ): Effect.Effect<DesktopGameHostRecord, DesktopWindowError> =>
    Effect.try({
      try: () => {
        const host = gameHosts.find(hostRendererId);
        if (host === null) {
          throw new Error(`Game view host is not open: ${hostRendererId}`);
        }
        return host;
      },
      catch: (cause) =>
        new DesktopWindowError({
          cause,
          detail: `Failed to resolve game view host: ${hostRendererId}`,
          id: String(hostRendererId),
        }),
    });

  const getGameViewHostState: DesktopWindowsShape["getGameViewHostState"] = (
    hostRendererId,
  ) => requireGameHost(hostRendererId).pipe(Effect.map(gameHosts.state));

  const getGameViewHostRendererId: DesktopWindowsShape["getGameViewHostRendererId"] =
    Effect.fn("DesktopWindows.getGameViewHostRendererId")(
      function* (gameRendererId) {
        const host = yield* Effect.try({
          try: () => {
            const host = findGameHostForView(gameRendererId);
            if (host === null) {
              throw new Error(`Game view host is not open: ${gameRendererId}`);
            }
            return host;
          },
          catch: (cause) =>
            new DesktopWindowError({
              cause,
              detail: `Failed to resolve game view host: ${gameRendererId}`,
              id: String(gameRendererId),
            }),
        });
        return host.rendererId;
      },
    );

  const setGameViewTabMenuOpen: DesktopWindowsShape["setGameViewTabMenuOpen"] =
    (hostRendererId, open) =>
      Effect.gen(function* () {
        const host = yield* requireGameHost(hostRendererId);
        yield* Effect.try({
          try: () => {
            if (open && host.groupControlsOpen) {
              gameHosts.setGroupControlsOpen(host, false);
            }
            gameHosts.setTabMenuOpen(host, open);
          },
          catch: (cause) =>
            new DesktopWindowError({
              cause,
              detail: "Failed to update the tab menu.",
              id: String(hostRendererId),
            }),
        });
        return host.tabMenuOpen;
      });

  const syncGameViewTabBarLayout: DesktopWindowsShape["syncGameViewTabBarLayout"] =
    (hostRendererId) =>
      Effect.gen(function* () {
        const host = yield* requireGameHost(hostRendererId);
        yield* Effect.try({
          try: () => gameHosts.syncTabBarLayout(host),
          catch: (cause) =>
            new DesktopWindowError({
              cause,
              detail: "Failed to synchronize the game view tab bar layout.",
              id: String(hostRendererId),
            }),
        });
      });

  const addGameView: DesktopWindowsShape["addGameView"] = (hostRendererId) =>
    Effect.gen(function* () {
      const host = yield* requireGameHost(hostRendererId);
      if (host.orderedIds.length >= MAX_GAME_VIEWS_PER_WINDOW) {
        return yield* new DesktopWindowError({
          detail: `This game window already has ${MAX_GAME_VIEWS_PER_WINDOW} views.`,
          id: String(hostRendererId),
        });
      }

      const bootstrapSettings = yield* getBootstrapSettings;
      const systemPrefersDark = yield* theme.shouldUseDarkColors;
      const snapshot = createAppearanceSnapshot(
        bootstrapSettings,
        systemPrefersDark,
      );
      yield* electronSession.prepareGameNetworking;
      yield* createGameViewInHost(host, () => {}, bootstrapSettings, snapshot);
      return gameHosts.state(host);
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof DesktopWindowError
          ? cause
          : new DesktopWindowError({
              cause,
              detail: "Failed to add a game view.",
              id: String(hostRendererId),
            }),
      ),
    );

  const closeGameView: DesktopWindowsShape["closeGameView"] = (
    hostRendererId,
    id,
  ) =>
    Effect.gen(function* () {
      const host = yield* requireGameHost(hostRendererId);
      const record = renderers.get(id);
      if (
        record === undefined ||
        !isGameViewRecord(record) ||
        record.gameHostRendererId !== host.rendererId
      ) {
        return yield* new DesktopWindowError({
          detail: `Game view does not belong to this host: ${id}`,
          id: String(id),
        });
      }
      yield* Effect.sync(() => closeGameViewRecord(id, record));
    });

  const selectGameView: DesktopWindowsShape["selectGameView"] = (
    hostRendererId,
    id,
    focus,
  ) =>
    Effect.gen(function* () {
      const host = yield* requireGameHost(hostRendererId);
      if (!host.orderedIds.includes(id)) {
        return yield* new DesktopWindowError({
          detail: `Game view does not belong to this host: ${id}`,
          id: String(id),
        });
      }

      yield* Effect.try({
        try: () => gameHosts.select(host, id, focus),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: `Failed to select game view: ${id}`,
            id: String(id),
          }),
      });
      return gameHosts.state(host);
    });

  const reorderGameViews: DesktopWindowsShape["reorderGameViews"] = (
    hostRendererId,
    ids,
  ) =>
    Effect.gen(function* () {
      const host = yield* requireGameHost(hostRendererId);
      const uniqueIds = new Set(ids);
      if (
        ids.length !== host.orderedIds.length ||
        uniqueIds.size !== ids.length ||
        ids.some((id) => !host.orderedIds.includes(id))
      ) {
        return yield* new DesktopWindowError({
          detail: "Game view order must contain every open view exactly once.",
          id: String(hostRendererId),
        });
      }
      if (ids.every((id, index) => host.orderedIds[index] === id)) {
        return gameHosts.state(host);
      }

      host.orderedIds.splice(0, host.orderedIds.length, ...ids);
      yield* Effect.try({
        try: () => gameHosts.refresh(host),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: "Failed to reorder game views.",
            id: String(hostRendererId),
          }),
      });
      return gameHosts.state(host);
    });

  const setGameViewLayout: DesktopWindowsShape["setGameViewLayout"] = (
    hostRendererId,
    layout,
  ) =>
    Effect.gen(function* () {
      const host = yield* requireGameHost(hostRendererId);
      if (host.layout === layout) {
        return gameHosts.state(host);
      }
      host.layout = layout;
      yield* Effect.try({
        try: () => gameHosts.refresh(host),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: `Failed to use ${layout} game view layout.`,
            id: String(hostRendererId),
          }),
      });
      return gameHosts.state(host);
    });

  const setGameViewGroupControlsOpen: DesktopWindowsShape["setGameViewGroupControlsOpen"] =
    (hostRendererId, open) =>
      Effect.gen(function* () {
        const host = yield* requireGameHost(hostRendererId);
        yield* Effect.try({
          try: () => gameHosts.setGroupControlsOpen(host, open),
          catch: (cause) =>
            new DesktopWindowError({
              cause,
              detail: `Failed to ${open ? "open" : "close"} group controls.`,
              id: String(hostRendererId),
            }),
        });
        return gameHosts.state(host);
      });

  const withGameViewGroupControlsNativeDialog: DesktopWindowsShape["withGameViewGroupControlsNativeDialog"] =
    (hostRendererId, use) =>
      Effect.gen(function* () {
        const host = yield* requireGameHost(hostRendererId);
        host.groupControlsNativeDialogOpen = true;

        return yield* use(host.window.id).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              host.groupControlsNativeDialogOpen = false;
              if (
                host.groupControlsOpen &&
                isElectronWindowUsable(host.window) &&
                !host.groupControlsView.webContents.isDestroyed()
              ) {
                host.window.contentView.addChildView(
                  host.groupControlsView.native,
                );
                host.groupControlsView.webContents.focus();
              }
            }),
          ),
        );
      });

  const setGameViewGroupTargets: DesktopWindowsShape["setGameViewGroupTargets"] =
    (hostRendererId, ids) =>
      Effect.gen(function* () {
        const host = yield* requireGameHost(hostRendererId);
        const uniqueIds = new Set(ids);
        if (
          uniqueIds.size !== ids.length ||
          ids.some((id) => !host.orderedIds.includes(id))
        ) {
          return yield* new DesktopWindowError({
            detail: "Group targets must be unique tabs in this game window.",
            id: String(hostRendererId),
          });
        }
        const orderedIds = host.orderedIds.filter((id) => uniqueIds.has(id));
        if (
          orderedIds.length === host.groupTargetIds.size &&
          orderedIds.every((id) => host.groupTargetIds.has(id))
        ) {
          return gameHosts.state(host);
        }

        host.groupTargetIds.clear();
        for (const id of orderedIds) host.groupTargetIds.add(id);
        gameHosts.publishState(host);
        return gameHosts.state(host);
      });

  const getGameViewPresentation: DesktopWindowsShape["getGameViewPresentation"] =
    (gameRendererId) =>
      Effect.try({
        try: () => {
          const record = findRenderer(gameRendererId);
          if (record === null || record.kind !== "game") {
            throw new Error(`Game renderer is not open: ${gameRendererId}`);
          }
          if (!isGameViewRecord(record)) {
            return standaloneGameViewPresentation(record.window);
          }
          const host = gameHosts.find(record.gameHostRendererId);
          if (host === null) {
            throw new Error(`Game view host is not open: ${gameRendererId}`);
          }
          return gameHosts.presentation(host, record.rendererId);
        },
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: `Failed to resolve game view presentation: ${gameRendererId}`,
            id: String(gameRendererId),
          }),
      });

  const setGameViewName: DesktopWindowsShape["setGameViewName"] = (
    gameRendererId,
    name,
  ) =>
    Effect.try({
      try: () => {
        const record = findRenderer(gameRendererId);
        if (record === null || record.kind !== "game") {
          throw new Error(`Game renderer is not open: ${gameRendererId}`);
        }
        const gameViewName = normalizeGameViewName(name);
        if (!isGameViewRecord(record)) {
          if (record.loggedInUsername === gameViewName) return;
          if (gameViewName === undefined) {
            delete record.loggedInUsername;
          } else {
            record.loggedInUsername = gameViewName;
          }
          refreshStandaloneGameWindowTitle(record);
          return;
        }
        if (
          record.gameViewName === gameViewName &&
          record.loggedInUsername === gameViewName
        ) {
          return;
        }
        if (gameViewName === undefined) {
          delete record.gameViewName;
          delete record.loggedInUsername;
        } else {
          record.gameViewName = gameViewName;
          record.loggedInUsername = gameViewName;
        }
        const host = gameHosts.find(record.gameHostRendererId);
        if (host !== null) {
          gameHosts.publishState(host);
        }
      },
      catch: (cause) =>
        new DesktopWindowError({
          cause,
          detail: `Failed to update game view name: ${gameRendererId}`,
          id: String(gameRendererId),
        }),
    });

  const open: DesktopWindowsShape["open"] = (kind, options) =>
    Effect.gen(function* () {
      const definition = getDesktopWindowDefinition(kind);
      const ownerId = yield* Effect.try({
        try: () => {
          if (definition.scope !== "game-child") {
            if (options?.ownerRendererId !== undefined) {
              throw new Error(
                `${kind} does not accept a logical owner window.`,
              );
            }
            return undefined;
          }

          if (options?.ownerRendererId === undefined) {
            throw new Error(`${kind} requires an owning game window.`);
          }

          const owner = findRenderer(options.ownerRendererId);
          if (
            owner === null ||
            owner.kind !== "game" ||
            owner.ownerId !== undefined
          ) {
            throw new Error(
              `The owning window must be an open root game: ${options.ownerRendererId}`,
            );
          }

          return owner.rendererId;
        },
        catch: (cause) =>
          new DesktopWindowError({
            id: kind,
            detail: `Invalid logical owner for desktop window: ${kind}`,
            cause,
          }),
      });
      if (definition.singleInstance) {
        const existing = findOpenInstance(kind, ownerId);
        if (existing !== null) {
          yield* revealExisting(existing.rendererId);
          return existing.rendererId;
        }
      }

      let registeredRendererId: number | undefined;
      const onRegistered = (rendererId: number): void => {
        registeredRendererId = rendererId;
      };
      const isTopLevelWindow = definition.scope !== "game-child";
      if (isTopLevelWindow) {
        openingTopLevelWindowCount += 1;
      }
      const openEffect = Effect.gen(function* () {
        const bootstrapSettings = yield* getBootstrapSettings;
        const systemPrefersDark = yield* theme.shouldUseDarkColors;
        const snapshot = createAppearanceSnapshot(
          bootstrapSettings,
          systemPrefersDark,
        );
        if (kind === "game") {
          yield* electronSession.prepareGameNetworking;
        }

        if (kind === "game" && bootstrapSettings.preferences.useGameTabs) {
          const gameHostTarget = options?.gameHostTarget;
          if (gameHostTarget !== undefined && gameHostTarget.kind !== "new") {
            const reusableHost =
              gameHostTarget.kind === "available"
                ? [...gameHosts.values()].find(
                    (host) =>
                      gameHosts.find(host.rendererId) !== null &&
                      host.orderedIds.length < MAX_GAME_VIEWS_PER_WINDOW,
                  )
                : (findGameHostForView(gameHostTarget.rendererId) ?? undefined);
            if (reusableHost !== undefined) {
              const rendererId = yield* createGameViewInHost(
                reusableHost,
                onRegistered,
                bootstrapSettings,
                snapshot,
                options,
              );
              yield* electronWindow.reveal(reusableHost.window);
              return rendererId;
            }
            if (gameHostTarget.kind === "game-view") {
              return yield* new DesktopWindowError({
                detail: `The target game window is not open: ${gameHostTarget.rendererId}`,
                id: String(gameHostTarget.rendererId),
              });
            }
          }

          return yield* createMultiGameWindow(
            onRegistered,
            definition,
            bootstrapSettings,
            snapshot,
            options,
          );
        }

        const gamePartition =
          kind === "game"
            ? yield* electronSession.acquireGamePartition(
                gamePartitionOwner(options),
              )
            : undefined;
        const window = yield* electronWindow
          .create(
            createWindowOptions(
              env,
              definition,
              bootstrapSettings,
              snapshot,
              gamePartition === undefined
                ? undefined
                : {
                    bridgeView: "game",
                    partition: gamePartition,
                  },
            ),
            kind === "game" ? openAllowedGameUrl : undefined,
          )
          .pipe(
            Effect.tapError(() =>
              gamePartition === undefined
                ? Effect.void
                : Effect.sync(() =>
                    electronSession.releaseGamePartition(gamePartition),
                  ),
            ),
          );
        const webContents = window.webContents;
        const rendererId = webContents.id;
        const record: DesktopRendererRecord = {
          rendererId,
          generation: INITIAL_WINDOW_GENERATION,
          kind,
          ...(gamePartition === undefined ? {} : { gamePartition }),
          ...(ownerId === undefined ? {} : { ownerId }),
          rendererReady: false,
          window,
        };
        renderers.set(rendererId, record);
        onRegistered(rendererId);
        if (kind === "game" && !isGameViewRecord(record)) {
          window.on("page-title-updated", (event) => {
            event.preventDefault();
            refreshStandaloneGameWindowTitle(record);
          });
          window.on("focus", () =>
            publishStandaloneGameViewPresentation(record),
          );
          window.on("blur", () =>
            publishStandaloneGameViewPresentation(record),
          );
          refreshStandaloneGameWindowTitle(record);
        }
        const createdEvent: DesktopWindowCreatedEvent = {
          rendererId,
          generation: INITIAL_WINDOW_GENERATION,
          kind,
        };
        const rendererDestroyedEvent: DesktopWindowRendererDestroyedEvent = {
          rendererId,
          kind,
        };
        const stopObservingAvailability = observeRendererAvailability(
          webContents,
          rendererDestroyedEvent,
          () => {
            markRendererUnavailable(record);
          },
        );
        const stopObservingWindowReloads = observeWindowReloads(
          webContents,
          (generation) => {
            beginRendererGeneration(record, generation);
            const reloadedEvent: DesktopWindowRendererReloadedEvent = {
              rendererId,
              generation,
              kind,
            };
            run(rendererReloadedEvents.publish(reloadedEvent));
          },
        );

        webContents.on("destroyed", () => {
          markRendererUnavailable(record);
          stopObservingAvailability();
          stopObservingWindowReloads();
          run(rendererDestroyedEvents.publish(rendererDestroyedEvent));
        });

        if (definition.closeBehavior === "hide") {
          window.on("close", (event) => {
            if (appIsQuitting || window.isDestroyed()) {
              return;
            }

            preventWindowClose(event);
            window.hide();
            if (isTopLevelWindow) {
              hiddenTopLevelWindowIds.add(rendererId);
              quitIfNoTopLevelWindow();
            }
          });
        }

        window.once("closed", () => {
          stopObservingWindowReloads();
          if (record.gamePartition !== undefined) {
            electronSession.releaseGamePartition(record.gamePartition);
          }
          const closedEvent: DesktopWindowClosedEvent = {
            rendererId,
            kind,
          };
          forgetWindow(rendererId);
          for (const record of renderers.values()) {
            const nativeWindow = nativeWindowForRenderer(record);
            if (
              record.ownerId === rendererId &&
              isElectronWindowUsable(nativeWindow)
            ) {
              nativeWindow.destroy();
            }
          }
          run(closedEvents.publish(closedEvent));
          if (isTopLevelWindow) {
            quitIfNoTopLevelWindow();
          }
        });

        yield* createdEvents.publish(createdEvent);

        if (options?.onCreated !== undefined) {
          yield* options.onCreated(createdEvent);
        }

        const socketProxy =
          kind === "game" ? yield* gameSocketRelayUrl : undefined;
        yield* electronWindow.loadFile(
          window,
          viewHtmlPath(definition.kind),
          socketProxy === undefined ? undefined : { query: { socketProxy } },
        );
        if (env.debug === true) {
          yield* Effect.try({
            try: () => webContents.openDevTools({ mode: "detach" }),
            catch: (cause) =>
              new DesktopWindowError({
                id: String(rendererId),
                detail: `Failed to open DevTools for desktop window: ${rendererId}`,
                cause,
              }),
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Failed to open DevTools").pipe(
                Effect.annotateLogs({
                  component: "window",
                  data: {
                    cause,
                    rendererId,
                    kind,
                  },
                }),
              ),
            ),
          );
        }
        yield* electronWindow.reveal(window);
        if (isTopLevelWindow) {
          hiddenTopLevelWindowIds.delete(rendererId);
          hasOpenedTopLevelWindow = true;
        }
        yield* Effect.logInfo("Desktop window opened").pipe(
          Effect.annotateLogs({
            component: "window",
            data: {
              rendererId,
              kind,
            },
          }),
        );
        return rendererId;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopWindowError({
              id: String(registeredRendererId ?? kind),
              detail: `Failed to open desktop window: ${kind}`,
              cause,
            }),
        ),
        Effect.onError(() =>
          registeredRendererId === undefined
            ? Effect.void
            : destroyFailedWindow(registeredRendererId, kind),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (!isTopLevelWindow) {
              return;
            }

            openingTopLevelWindowCount -= 1;
            quitIfNoTopLevelWindow();
          }),
        ),
      );

      return yield* openEffect;
    });

  const restorePrimaryWindow = Effect.fn("DesktopWindows.restorePrimaryWindow")(
    function* () {
      if (
        appIsQuitting ||
        !hasOpenedTopLevelWindow ||
        openingTopLevelWindowCount > 0 ||
        hasPresentableTopLevelWindow()
      ) {
        return;
      }

      const accountManager = findOpenInstance("account-manager", undefined);
      if (accountManager !== null) {
        if (yield* revealExisting(accountManager.rendererId)) {
          return;
        }
      }

      const currentSettings = yield* getBootstrapSettings;
      yield* open(
        currentSettings.preferences.launchMode === "account-manager"
          ? "account-manager"
          : "game",
      );
    },
  );

  if (env.platform === "darwin") {
    const unsubscribeActivate = yield* app.on("activate", () => {
      run(
        restorePrimaryWindow().pipe(
          Effect.catch((cause) =>
            Effect.logWarning(
              "Failed to restore a primary window after macOS activation",
            ).pipe(
              Effect.annotateLogs({ component: "window", data: { cause } }),
            ),
          ),
        ),
      );
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribeActivate));
  }

  return DesktopWindows.of({
    addGameView,
    closeRenderer,
    closeGameView,
    getRendererIds,
    getNativeWindowId,
    getRendererKind,
    getGameViewHostRendererId,
    getGameViewHostState,
    getGameViewPresentation,
    getOwnedRendererIds,
    getOwnerRendererId,
    getRendererGeneration,
    isRendererReady,
    markRendererReady,
    onClosed: closedEvents.subscribe,
    onCreated: createdEvents.subscribe,
    onRendererDestroyed: rendererDestroyedEvents.subscribe,
    onRendererUnavailable: rendererUnavailableEvents.subscribe,
    onRendererReloaded: rendererReloadedEvents.subscribe,
    onRendererReady: rendererReadyEvents.subscribe,
    open,
    revealRenderer,
    reorderGameViews,
    reloadFocusedGameContents,
    selectGameView,
    setBackgroundColor,
    setGameViewGroupControlsOpen,
    setGameViewGroupTargets,
    setGameViewLayout,
    setGameViewName,
    setGameViewTabMenuOpen,
    syncGameViewTabBarLayout,
    withGameViewGroupControlsNativeDialog,
  });
});

export const layer = Layer.effect(DesktopWindows, makeDesktopWindows);
