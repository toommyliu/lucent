import { randomBytes } from "crypto";
import { join } from "path";

import {
  screen,
  type BrowserViewConstructorOptions,
  type BrowserWindowConstructorOptions,
  type Event as ElectronEvent,
  type Input,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import appBranding from "../../../appBranding.json";
import {
  GAME_VIEW_TAB_BAR_HEIGHT,
  MAX_GAME_VIEWS_PER_WINDOW,
  gameViewFallbackName,
  type GameViewHostState,
  type GameViewLayout,
  type GameViewPresentation,
  type GameViewSelectionFocus,
  type GameViewSession,
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
  serializeDebugModeArgument,
  serializeGameConsoleObservabilityArgument,
  serializeTraceProjectionsArgument,
} from "../../shared/rendererBootstrapArguments";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@lucent/core/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import {
  ElectronGameView,
  type ElectronGameViewHandle,
} from "../electron/ElectronGameView";
import { ElectronSession } from "../electron/ElectronSession";
import { ElectronShell } from "../electron/ElectronShell";
import { ElectronTheme } from "../electron/ElectronTheme";
import {
  ElectronWindow,
  isElectronWindowUsable,
  type ElectronWindowCreateOptions,
  type ElectronWindowHandle,
} from "../electron/ElectronWindow";
import { DesktopSettings } from "../settings/DesktopSettings";
import {
  getDesktopWindowDefinition,
  type DesktopRendererKind,
  type DesktopWindowDefinition,
  type DesktopWindowKind,
} from "./DesktopWindowCatalog";
import { focusedGameViewBounds, gridGameViewBounds } from "./GameViewLayout";
import {
  readGameViewShortcutIndex,
  readGameViewShortcutModifierHintUpdate,
} from "./GameViewShortcuts";
import { parseAllowedGameWindowOpenUrl } from "./GameWindowOpenPolicy";
import {
  INITIAL_WINDOW_GENERATION,
  observeWindowReloads,
} from "./WindowGeneration";

export type DesktopWindowInstanceId = string;

export class DesktopWindowError extends Schema.TaggedErrorClass<DesktopWindowError>()(
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
  readonly activateGameView: (
    gameRendererId: number,
  ) => Effect.Effect<GameViewPresentation, DesktopWindowError>;
  readonly closeBrowserWindow: (
    browserWindowId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly getBrowserWindowIds: (
    kind: DesktopWindowKind,
  ) => Effect.Effect<readonly number[]>;
  readonly getBrowserWindowId: (
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getBrowserWindowGroupId: (
    browserWindowId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getBrowserWindowKind: (
    browserWindowId: number,
  ) => Effect.Effect<DesktopRendererKind | null, DesktopWindowError>;
  readonly getOwnedBrowserWindowIds: (
    ownerBrowserWindowId: number,
    kind?: DesktopWindowKind,
  ) => Effect.Effect<readonly number[], DesktopWindowError>;
  readonly getOwnerBrowserWindowId: (
    browserWindowId: number,
  ) => Effect.Effect<number | null, DesktopWindowError>;
  readonly getRendererGeneration: (
    browserWindowId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly isRendererReady: (
    browserWindowId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly markRendererReady: (
    browserWindowId: number,
    generation: number,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly addGameView: (
    hostRendererId: number,
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly closeGameView: (
    hostRendererId: number,
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly getGameViewHostState: (
    hostRendererId: number,
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
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
  ) => Effect.Effect<DesktopWindowInstanceId, DesktopWindowError>;
  readonly reveal: (
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly revealBrowserWindow: (
    browserWindowId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly retireManagedGameProfile: (
    key: string,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly reorderGameViews: (
    hostRendererId: number,
    ids: readonly DesktopWindowInstanceId[],
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly selectGameView: (
    hostRendererId: number,
    id: DesktopWindowInstanceId,
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
    ids: readonly DesktopWindowInstanceId[],
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  readonly setGameViewName: (
    gameRendererId: number,
    name: string,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly setGameViewTabMenuOpen: (
    hostRendererId: number,
    open: boolean,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly withGameViewGroupControlsNativeDialog: <A, E, R>(
    hostRendererId: number,
    use: (parentWindowId: number) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, DesktopWindowError | E, R>;
}

export class DesktopWindows extends Context.Service<
  DesktopWindows,
  DesktopWindowsShape
>()("lucent/desktop/window/DesktopWindows") {}

export type DesktopWindowTileAlgorithm =
  | "auto-grid"
  | "horizontal"
  | "vertical";

export interface DesktopWindowTilePlacement {
  readonly algorithm: DesktopWindowTileAlgorithm;
  readonly count: number;
  readonly index: number;
}

export interface DesktopWindowOpenOptions {
  readonly gameViewName?: string;
  readonly managedGameProfileKey?: string;
  readonly onCreated?: (
    event: DesktopWindowCreatedEvent,
  ) => Effect.Effect<void, unknown>;
  readonly ownerBrowserWindowId?: number;
  readonly reuseGameHost?: boolean;
  readonly tile?: DesktopWindowTilePlacement;
}

const usesGameViewGrid = (
  options: DesktopWindowOpenOptions | undefined,
): boolean => options?.tile?.algorithm === "auto-grid";

interface DesktopWindowBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const rendererRoot = join(__dirname, "../renderer");
const preloadPath = join(rendererRoot, "preload.js");
const GAME_VIEW_RESIZE_SETTLE_DELAY_MS = 100;
const GAME_GROUP_CONTROLS_HEIGHT = 408;
const GAME_GROUP_CONTROLS_MARGIN = 8;
const GAME_GROUP_CONTROLS_WIDTH = 392;

const viewHtmlPath = (kind: DesktopBridgeView): string =>
  join(rendererRoot, kind, "index.html");

const normalizeTilePlacement = (
  tile: DesktopWindowTilePlacement | undefined,
): DesktopWindowTilePlacement | undefined => {
  if (
    tile === undefined ||
    !Number.isSafeInteger(tile.index) ||
    !Number.isSafeInteger(tile.count) ||
    tile.index < 0 ||
    tile.count <= 1 ||
    tile.index >= tile.count
  ) {
    return undefined;
  }

  return tile;
};

const gridForTilePlacement = (
  tile: DesktopWindowTilePlacement,
): { readonly columns: number; readonly rows: number } => {
  switch (tile.algorithm) {
    case "auto-grid": {
      const columns = Math.ceil(Math.sqrt(tile.count));
      return { columns, rows: Math.ceil(tile.count / columns) };
    }
    case "horizontal":
      return { columns: tile.count, rows: 1 };
    case "vertical":
      return { columns: 1, rows: tile.count };
  }
};

const partitionDimension = (
  origin: number,
  size: number,
  index: number,
  parts: number,
): { readonly origin: number; readonly size: number } => {
  const normalizedSize = Math.max(1, Math.round(size));
  const start = origin + Math.floor((normalizedSize * index) / parts);
  const end = origin + Math.floor((normalizedSize * (index + 1)) / parts);
  return {
    origin: start,
    size: Math.max(1, end - start),
  };
};

const resolveTileBounds = (
  tile: DesktopWindowTilePlacement | undefined,
): DesktopWindowBounds | undefined => {
  const normalizedTile = normalizeTilePlacement(tile);
  if (normalizedTile === undefined) {
    return undefined;
  }

  const workArea = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  const { columns, rows } = gridForTilePlacement(normalizedTile);
  const column = normalizedTile.index % columns;
  const row = Math.floor(normalizedTile.index / columns);
  const x = partitionDimension(workArea.x, workArea.width, column, columns);
  const y = partitionDimension(workArea.y, workArea.height, row, rows);

  return {
    height: y.size,
    width: x.size,
    x: x.origin,
    y: y.origin,
  };
};

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
    readonly rendererBackgroundColor?: string;
    readonly requiresFlashPlugin: boolean;
  },
): DesktopRendererWebPreferences => ({
  additionalArguments: [
    // BrowserView otherwise initializes its renderer backing surface to white.
    ...(options.rendererBackgroundColor === undefined
      ? []
      : [`--background-color=${options.rendererBackgroundColor}`]),
    serializeDesktopViewArgument(bridgeView),
    serializeAppearanceSnapshotArgument(snapshot),
    serializeSettingsSnapshotArgument(settings),
    ...(env.debug === true ? [serializeDebugModeArgument()] : []),
    ...(bridgeView === "game" && env.debug === true
      ? [serializeGameConsoleObservabilityArgument()]
      : []),
    ...(bridgeView === "game" && env.traceProjections === true
      ? [serializeTraceProjectionsArgument()]
      : []),
  ],
  ...(options.backgroundThrottling === undefined
    ? {}
    : { backgroundThrottling: options.backgroundThrottling }),
  contextIsolation: true,
  nodeIntegration: false,
  preload: preloadPath,
  sandbox: false,
  plugins: options.requiresFlashPlugin,
});

const createWindowOptions = (
  env: DesktopEnvironment["Service"],
  definition: DesktopWindowDefinition,
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
  bounds?: DesktopWindowBounds,
  renderer?: {
    readonly bridgeView: DesktopBridgeView;
    readonly partition?: string;
    readonly requiresFlashPlugin: boolean;
  },
): ElectronWindowCreateOptions => {
  const width = bounds?.width ?? definition.width;
  const height = bounds?.height ?? definition.height;
  const activeBranding = env.isDev ? appBranding.dev : appBranding.production;
  const appIconPath = join(env.assetsDir, activeBranding.iconPng);

  return {
    width,
    height,
    ...(bounds === undefined ? {} : { x: bounds.x, y: bounds.y }),
    ...(definition.minWidth === undefined
      ? {}
      : { minWidth: Math.min(definition.minWidth, width) }),
    ...(definition.minHeight === undefined
      ? {}
      : { minHeight: Math.min(definition.minHeight, height) }),
    ...(env.platform === "linux" ? { icon: appIconPath } : {}),
    backgroundColor: snapshot.backgroundColor,
    show: false,
    webPreferences: {
      ...createRendererWebPreferences(
        env,
        renderer?.bridgeView ?? definition.kind,
        settings,
        snapshot,
        {
          requiresFlashPlugin:
            renderer?.requiresFlashPlugin ?? definition.requiresFlashPlugin,
        },
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
  | { readonly kind: "managed-account"; readonly key: string }
  | { readonly kind: "standalone" } =>
  options?.managedGameProfileKey === undefined
    ? { kind: "standalone" }
    : { kind: "managed-account", key: options.managedGameProfileKey };

const createGameViewOptions = (
  env: DesktopEnvironment["Service"],
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
  partition: string,
): BrowserViewConstructorOptions => ({
  webPreferences: {
    ...createRendererWebPreferences(env, "game", settings, snapshot, {
      backgroundThrottling: false,
      rendererBackgroundColor: snapshot.backgroundColor,
      requiresFlashPlugin: true,
    }),
    partition,
  },
});

const createGameGroupControlsViewOptions = (
  env: DesktopEnvironment["Service"],
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
): BrowserViewConstructorOptions => ({
  webPreferences: createRendererWebPreferences(
    env,
    "game-group-controls",
    settings,
    snapshot,
    { requiresFlashPlugin: false },
  ),
});

const createGameHostViewOptions = (
  env: DesktopEnvironment["Service"],
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
): BrowserViewConstructorOptions => ({
  webPreferences: createRendererWebPreferences(
    env,
    "game-host",
    settings,
    snapshot,
    { requiresFlashPlugin: false },
  ),
});

interface DesktopWindowRecordBase {
  readonly browserWindowId: number;
  generation: number;
  readonly kind: DesktopWindowKind;
  // ownerId is logical ownership only; Electron parent windows are intentionally not used.
  readonly ownerId?: DesktopWindowInstanceId;
  rendererReady: boolean;
  readonly window: ElectronWindowHandle;
}

interface DesktopBrowserWindowRecord extends DesktopWindowRecordBase {
  readonly gamePartition?: string;
  readonly gameHostRendererId?: never;
  readonly gameView?: never;
  publishedPresentation?: GameViewPresentation;
}

interface DesktopGameViewRecord extends DesktopWindowRecordBase {
  readonly gameHostRendererId: number;
  readonly gamePartition: string;
  readonly gameView: ElectronGameViewHandle;
  gameViewError?: string;
  gameViewName?: string;
  gameViewPhase: GameViewSession["phase"];
  publishedPresentation?: GameViewPresentation;
  stopObservingFocus: () => void;
  stopObservingReloads: () => void;
  stopObservingShortcutInput: () => void;
}

type DesktopWindowRecord = DesktopBrowserWindowRecord | DesktopGameViewRecord;

interface DesktopGameHostRecord {
  closing: boolean;
  groupControlsNativeDialogOpen: boolean;
  readonly groupControlsView: ElectronGameViewHandle;
  groupControlsOpen: boolean;
  readonly groupTargetIds: Set<DesktopWindowInstanceId>;
  readonly hostView: ElectronGameViewHandle;
  readonly rendererId: number;
  layout: GameViewLayout;
  readonly orderedIds: DesktopWindowInstanceId[];
  repaintTimer?: ReturnType<typeof setTimeout>;
  resizeSettleTimer?: ReturnType<typeof setTimeout>;
  selectedId: DesktopWindowInstanceId;
  shortcutModifierPressed: boolean;
  stackedGameViewId?: DesktopWindowInstanceId;
  stopObservingShortcutInput: () => void;
  tabMenuOpen: boolean;
  readonly window: ElectronWindowHandle;
}

export interface DesktopWindowClosedEvent {
  readonly browserWindowId: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowCreatedEvent {
  readonly browserWindowId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererDestroyedEvent {
  readonly browserWindowId: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererReloadedEvent {
  readonly browserWindowId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererReadyEvent {
  readonly browserWindowId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

const makeInstanceId = (kind: DesktopWindowKind): DesktopWindowInstanceId =>
  `${kind}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;

const isGameViewRecord = (
  record: DesktopWindowRecord,
): record is DesktopGameViewRecord => record.gameView !== undefined;

const normalizeGameViewName = (
  value: string | undefined,
): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === ""
    ? undefined
    : normalized.slice(0, 64);
};

const gameViewSession = (
  id: DesktopWindowInstanceId,
  record: DesktopGameViewRecord,
  index: number,
): GameViewSession => ({
  id,
  name: record.gameViewName ?? gameViewFallbackName(index),
  phase: record.gameViewPhase,
  ...(record.gameViewError === undefined
    ? {}
    : { error: record.gameViewError }),
});

const gameViewPresentation = (
  host: DesktopGameHostRecord,
  id: DesktopWindowInstanceId,
): GameViewPresentation => ({
  active: host.selectedId === id,
  layout: host.layout,
  windowActive: host.window.isFocused(),
});

const standaloneGameViewPresentation = (
  window: ElectronWindowHandle,
): GameViewPresentation => ({
  active: true,
  layout: "focused",
  windowActive: window.isFocused(),
});

const gameGroupControlsBounds = (
  width: number,
  height: number,
): {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
} => {
  const availableWidth = Math.max(1, width - GAME_GROUP_CONTROLS_MARGIN * 2);
  const availableHeight = Math.max(
    1,
    height - GAME_VIEW_TAB_BAR_HEIGHT - GAME_GROUP_CONTROLS_MARGIN * 2,
  );
  const panelWidth = Math.min(GAME_GROUP_CONTROLS_WIDTH, availableWidth);
  const panelHeight = Math.min(GAME_GROUP_CONTROLS_HEIGHT, availableHeight);
  return {
    height: panelHeight,
    width: panelWidth,
    x: Math.max(
      GAME_GROUP_CONTROLS_MARGIN,
      width - panelWidth - GAME_GROUP_CONTROLS_MARGIN,
    ),
    y: GAME_VIEW_TAB_BAR_HEIGHT + GAME_GROUP_CONTROLS_MARGIN,
  };
};

const sameGameViewPresentation = (
  left: GameViewPresentation,
  right: GameViewPresentation,
): boolean =>
  left.active === right.active &&
  left.layout === right.layout &&
  left.windowActive === right.windowActive;

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

const setGameViewBounds = (
  view: ElectronGameViewHandle,
  bounds: ReturnType<typeof focusedGameViewBounds>,
): void => {
  const current = view.getBounds();
  if (
    current.x !== bounds.x ||
    current.y !== bounds.y ||
    current.width !== bounds.width ||
    current.height !== bounds.height
  ) {
    view.setBounds(bounds);
  }
};

const cancelGameViewHostRepaint = (host: DesktopGameHostRecord): void => {
  if (host.repaintTimer === undefined) {
    return;
  }
  clearTimeout(host.repaintTimer);
  delete host.repaintTimer;
};

const cancelGameViewHostResize = (host: DesktopGameHostRecord): void => {
  if (host.resizeSettleTimer !== undefined) {
    clearTimeout(host.resizeSettleTimer);
    delete host.resizeSettleTimer;
  }
};

const setGameViewShortcutModifierPressed = (
  host: DesktopGameHostRecord,
  pressed: boolean,
): void => {
  if (host.shortcutModifierPressed === pressed) {
    return;
  }
  host.shortcutModifierPressed = pressed;
  if (
    !isElectronWindowUsable(host.window) ||
    host.hostView.webContents.isDestroyed()
  ) {
    return;
  }
  try {
    host.hostView.webContents.send(
      GameViewsIpc.shortcutModifierChanged.channel,
      pressed,
    );
  } catch {}
};

const publishGameViewTabMenuOpen = (host: DesktopGameHostRecord): void => {
  if (host.hostView.webContents.isDestroyed()) return;
  try {
    host.hostView.webContents.send(
      GameViewsIpc.tabMenuOpenChanged.channel,
      host.tabMenuOpen,
    );
  } catch {}
};

const makeDesktopWindows = Effect.gen(function* () {
  const app = yield* ElectronApp;
  const env = yield* DesktopEnvironment;
  const electronGameView = yield* ElectronGameView;
  const electronWindow = yield* ElectronWindow;
  const electronSession = yield* ElectronSession;
  const electronShell = yield* ElectronShell;
  const observability = yield* DesktopObservability;
  const settings = yield* DesktopSettings;
  const theme = yield* ElectronTheme;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const windows = new Map<DesktopWindowInstanceId, DesktopWindowRecord>();
  const hiddenTopLevelWindowIds = new Set<DesktopWindowInstanceId>();
  const gameHosts = new Map<number, DesktopGameHostRecord>();
  const gameGroupControlHosts = new Map<number, DesktopGameHostRecord>();
  const createdListeners = new Set<
    (event: DesktopWindowCreatedEvent) => Effect.Effect<void, unknown>
  >();
  const closedListeners = new Set<
    (event: DesktopWindowClosedEvent) => Effect.Effect<void, unknown>
  >();
  const rendererDestroyedListeners = new Set<
    (event: DesktopWindowRendererDestroyedEvent) => Effect.Effect<void, unknown>
  >();
  const rendererReloadedListeners = new Set<
    (event: DesktopWindowRendererReloadedEvent) => Effect.Effect<void, unknown>
  >();
  const rendererReadyListeners = new Set<
    (event: DesktopWindowRendererReadyEvent) => Effect.Effect<void, unknown>
  >();

  const forgetUnusableWindowRecord = (
    id: DesktopWindowInstanceId,
    record: DesktopWindowRecord,
  ): void => {
    // Hosted game views are removed by their host lifecycle so it can still
    // publish one close event per session after Electron destroys renderers.
    if (!isGameViewRecord(record)) {
      windows.delete(id);
      hiddenTopLevelWindowIds.delete(id);
    }
  };
  let appIsQuitting = false;
  let hasOpenedTopLevelWindow = false;
  let quitRequested = false;
  // An in-flight top-level open is recoverable UI during a concurrent close.
  let openingTopLevelWindowCount = 0;

  const forgetWindow = (id: DesktopWindowInstanceId): void => {
    windows.delete(id);
    hiddenTopLevelWindowIds.delete(id);
  };

  const openAllowedGameUrl = (rawUrl: string): void => {
    const url = parseAllowedGameWindowOpenUrl(rawUrl);
    if (url === null) {
      return;
    }

    void runPromise(
      electronShell.openExternal(url).pipe(
        Effect.flatMap((opened) =>
          opened
            ? Effect.void
            : observability.warn("window", "Failed to open game URL", {
                url,
              }),
        ),
      ),
    ).catch(() => undefined);
  };

  const findGameHost = (rendererId: number): DesktopGameHostRecord | null => {
    const host =
      gameHosts.get(rendererId) ?? gameGroupControlHosts.get(rendererId);
    if (
      host === undefined ||
      host.closing ||
      !isElectronWindowUsable(host.window) ||
      host.groupControlsView.webContents.isDestroyed() ||
      host.hostView.webContents.isDestroyed()
    ) {
      if (host !== undefined) {
        gameHosts.delete(host.rendererId);
        gameGroupControlHosts.delete(host.groupControlsView.webContents.id);
      }
      return null;
    }
    return host;
  };

  const gameViewHostState = (
    host: DesktopGameHostRecord,
  ): GameViewHostState => ({
    capacity: MAX_GAME_VIEWS_PER_WINDOW,
    groupControlsOpen: host.groupControlsOpen,
    groupTargetIds: host.orderedIds.filter((id) => host.groupTargetIds.has(id)),
    layout: host.layout,
    selectedId: host.selectedId,
    sessions: host.orderedIds.flatMap((id, index) => {
      const record = windows.get(id);
      return record !== undefined && isGameViewRecord(record)
        ? [gameViewSession(id, record, index)]
        : [];
    }),
  });

  const applyGameGroupControlsLayout = (
    host: DesktopGameHostRecord,
    width: number,
    height: number,
  ): void => {
    if (!host.groupControlsOpen) return;
    setGameViewBounds(
      host.groupControlsView,
      gameGroupControlsBounds(width, height),
    );
    host.window.setTopBrowserView(host.groupControlsView);
  };

  const applyGameHostViewLayout = (
    host: DesktopGameHostRecord,
    width: number,
    height: number,
  ): void => {
    setGameViewBounds(host.hostView, {
      height: host.tabMenuOpen ? Math.max(1, height) : GAME_VIEW_TAB_BAR_HEIGHT,
      width: Math.max(1, width),
      x: 0,
      y: 0,
    });
    host.window.setTopBrowserView(host.hostView);
  };

  const applyGameHostOverlaysLayout = (
    host: DesktopGameHostRecord,
    width: number,
    height: number,
  ): void => {
    applyGameGroupControlsLayout(host, width, height);
    applyGameHostViewLayout(host, width, height);
  };

  const applyGameViewHostLayout = (host: DesktopGameHostRecord): void => {
    if (!isElectronWindowUsable(host.window)) {
      return;
    }

    const { height, width } = host.window.getContentBounds();
    const topInset = GAME_VIEW_TAB_BAR_HEIGHT;
    if (host.layout === "focused") {
      const bounds = focusedGameViewBounds(width, height, topInset);
      const selected = windows.get(host.selectedId);
      if (selected !== undefined && isGameViewRecord(selected)) {
        setGameViewBounds(selected.gameView, bounds);
        if (host.stackedGameViewId !== host.selectedId) {
          host.window.setTopBrowserView(selected.gameView);
          host.stackedGameViewId = host.selectedId;
        }
      }

      // Keep inactive views at their final focused size behind the selected
      // view. Tab changes then only alter native stacking order, avoiding a
      // blank frame and an unnecessary Flash resize.
      for (const id of host.orderedIds) {
        if (id === host.selectedId) {
          continue;
        }
        const record = windows.get(id);
        if (record !== undefined && isGameViewRecord(record)) {
          setGameViewBounds(record.gameView, bounds);
        }
      }
      applyGameHostOverlaysLayout(host, width, height);
      return;
    }

    for (const [index, id] of host.orderedIds.entries()) {
      const record = windows.get(id);
      if (record !== undefined && isGameViewRecord(record)) {
        setGameViewBounds(
          record.gameView,
          gridGameViewBounds(
            width,
            height,
            topInset,
            index,
            host.orderedIds.length,
          ),
        );
      }
    }
    applyGameHostOverlaysLayout(host, width, height);
  };

  const repaintGameViewHost = (host: DesktopGameHostRecord): void => {
    if (!isElectronWindowUsable(host.window)) {
      return;
    }

    if (!host.hostView.webContents.isDestroyed()) {
      host.hostView.webContents.invalidate();
    }
    const visibleIds =
      host.layout === "focused" ? [host.selectedId] : host.orderedIds;
    for (const id of visibleIds) {
      const record = windows.get(id);
      if (
        record !== undefined &&
        isGameViewRecord(record) &&
        !record.gameView.webContents.isDestroyed()
      ) {
        record.gameView.webContents.invalidate();
      }
    }
    if (
      host.groupControlsOpen &&
      !host.groupControlsView.webContents.isDestroyed()
    ) {
      host.groupControlsView.webContents.invalidate();
    }
  };

  const scheduleGameViewHostRepaint = (host: DesktopGameHostRecord): void => {
    cancelGameViewHostRepaint(host);
    host.repaintTimer = setTimeout(() => {
      delete host.repaintTimer;
      repaintGameViewHost(host);
    }, 16);
  };

  const finishGameViewHostResize = (host: DesktopGameHostRecord): void => {
    cancelGameViewHostResize(host);
    cancelGameViewHostRepaint(host);
    if (host.closing) {
      return;
    }

    try {
      // BrowserView bounds remain unchanged throughout live resize so Flash
      // receives only the final viewport size.
      applyGameViewHostLayout(host);
      repaintGameViewHost(host);
    } catch {}
  };

  const scheduleGameViewHostResize = (host: DesktopGameHostRecord): void => {
    if (host.closing) {
      return;
    }

    cancelGameViewHostRepaint(host);
    if (env.platform !== "linux") {
      return;
    }

    if (host.resizeSettleTimer !== undefined) {
      clearTimeout(host.resizeSettleTimer);
    }
    // Linux does not emit BrowserWindow's `resized` event.
    host.resizeSettleTimer = setTimeout(
      () => finishGameViewHostResize(host),
      GAME_VIEW_RESIZE_SETTLE_DELAY_MS,
    );
  };

  const publishGameViewPresentations = (host: DesktopGameHostRecord): void => {
    for (const id of host.orderedIds) {
      const record = windows.get(id);
      if (
        record === undefined ||
        !isGameViewRecord(record) ||
        record.gameView.webContents.isDestroyed()
      ) {
        continue;
      }
      const presentation = gameViewPresentation(host, id);
      if (
        record.publishedPresentation !== undefined &&
        sameGameViewPresentation(record.publishedPresentation, presentation)
      ) {
        continue;
      }
      record.publishedPresentation = presentation;
      record.gameView.webContents.send(
        GameViewsIpc.presentationChanged.channel,
        presentation,
      );
    }
  };

  const publishGameViewHostState = (host: DesktopGameHostRecord): void => {
    if (!isElectronWindowUsable(host.window)) {
      return;
    }

    const state = gameViewHostState(host);
    if (!host.hostView.webContents.isDestroyed()) {
      host.hostView.webContents.send(GameViewsIpc.changed.channel, state);
    }
    if (!host.groupControlsView.webContents.isDestroyed()) {
      host.groupControlsView.webContents.send(
        GameViewsIpc.changed.channel,
        state,
      );
    }
    publishGameViewPresentations(host);
  };

  const publishStandaloneGameViewPresentation = (
    record: DesktopBrowserWindowRecord,
  ): void => {
    if (record.kind !== "game" || record.window.webContents.isDestroyed()) {
      return;
    }

    const presentation = standaloneGameViewPresentation(record.window);
    if (
      record.publishedPresentation !== undefined &&
      sameGameViewPresentation(record.publishedPresentation, presentation)
    ) {
      return;
    }
    record.publishedPresentation = presentation;
    record.window.webContents.send(
      GameViewsIpc.presentationChanged.channel,
      presentation,
    );
  };

  const refreshGameViewHost = (host: DesktopGameHostRecord): void => {
    cancelGameViewHostResize(host);
    applyGameViewHostLayout(host);
    publishGameViewHostState(host);
    scheduleGameViewHostRepaint(host);
  };

  const activateGameViewInHost = (
    host: DesktopGameHostRecord,
    id: DesktopWindowInstanceId,
  ): void => {
    if (host.selectedId === id) return;
    host.selectedId = id;
    publishGameViewHostState(host);
  };

  const updateGameTabMenuOpen = (
    host: DesktopGameHostRecord,
    open: boolean,
  ): void => {
    if (host.tabMenuOpen === open) return;
    const previousOpen = host.tabMenuOpen;
    host.tabMenuOpen = open;
    try {
      applyGameViewHostLayout(host);
    } catch (cause) {
      host.tabMenuOpen = previousOpen;
      try {
        applyGameViewHostLayout(host);
      } catch {}
      throw cause;
    }
    scheduleGameViewHostRepaint(host);
    if (open && !host.hostView.webContents.isDestroyed()) {
      try {
        host.hostView.webContents.focus();
      } catch {}
    }
    publishGameViewTabMenuOpen(host);
  };

  const updateGameGroupControlsOpen = (
    host: DesktopGameHostRecord,
    open: boolean,
  ): void => {
    if (host.groupControlsOpen === open) return;
    if (open && host.tabMenuOpen) {
      updateGameTabMenuOpen(host, false);
    }
    if (open) {
      host.window.addBrowserView(host.groupControlsView);
    } else {
      host.window.removeBrowserView(host.groupControlsView);
    }
    host.groupControlsOpen = open;
    if (!open) {
      // Force focused mode to restore the selected game after detaching the popover.
      delete host.stackedGameViewId;
    }
    refreshGameViewHost(host);
    if (open && !host.groupControlsView.webContents.isDestroyed()) {
      host.groupControlsView.webContents.focus();
      return;
    }

    const selected = windows.get(host.selectedId);
    if (
      !open &&
      selected !== undefined &&
      isGameViewRecord(selected) &&
      !selected.gameView.webContents.isDestroyed()
    ) {
      selected.gameView.webContents.focus();
    }
  };

  const selectGameViewInHost = (
    host: DesktopGameHostRecord,
    id: DesktopWindowInstanceId,
    focus: GameViewSelectionFocus,
  ): void => {
    const record = windows.get(id);
    if (
      record === undefined ||
      !isGameViewRecord(record) ||
      record.gameHostRendererId !== host.rendererId
    ) {
      throw new Error(`Game view does not belong to this host: ${id}`);
    }

    if (host.selectedId !== id || host.layout !== "focused") {
      host.selectedId = id;
      host.layout = "focused";
      refreshGameViewHost(host);
    }
    if (focus === "host") {
      if (!host.hostView.webContents.isDestroyed()) {
        host.hostView.webContents.focus();
      }
    } else if (!record.gameView.webContents.isDestroyed()) {
      record.gameView.webContents.focus();
    }
  };

  const focusGameViewInHost = (
    host: DesktopGameHostRecord,
    id: DesktopWindowInstanceId,
  ): void => {
    selectGameViewInHost(host, id, "view");
  };

  const makeGameViewShortcutInputListener =
    (
      host: DesktopGameHostRecord,
    ): ((event: ElectronEvent, input: Input) => void) =>
    (event, input) => {
      const modifierHintUpdate = readGameViewShortcutModifierHintUpdate(
        input,
        env.platform,
      );
      if (modifierHintUpdate !== null) {
        setGameViewShortcutModifierPressed(host, modifierHintUpdate);
      }

      const index = readGameViewShortcutIndex(
        input,
        env.platform,
        host.orderedIds.length,
      );
      if (index === null) {
        return;
      }
      const id = host.orderedIds[index];
      if (id === undefined) {
        return;
      }

      event.preventDefault();
      try {
        focusGameViewInHost(host, id);
      } catch (cause) {
        void runPromise(
          observability.warn("window", "Failed to use game view shortcut", {
            cause,
            hostRendererId: host.rendererId,
            id,
          }),
        ).catch(() => undefined);
      }
    };

  const unsubscribeBeforeQuit = yield* app.on("before-quit", () => {
    appIsQuitting = true;
  });
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeBeforeQuit));

  const hasPresentableTopLevelWindow = (): boolean =>
    [...windows.entries()].some(
      ([id, record]) =>
        getDesktopWindowDefinition(record.kind).scope !== "game-child" &&
        !hiddenTopLevelWindowIds.has(id) &&
        isElectronWindowUsable(record.window),
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
    void runPromise(app.quit).catch(() => {
      quitRequested = false;
    });
  };

  const destroyFailedWindow = Effect.fn("DesktopWindows.destroyFailedWindow")(
    function* (id: DesktopWindowInstanceId, kind: DesktopWindowKind) {
      yield* Effect.try({
        try: () => {
          const record = windows.get(id);
          if (record === undefined) {
            return;
          }

          if (record.window.isDestroyed()) {
            forgetWindow(id);
            return;
          }

          // A failed launch into an existing host owns only the new view.
          // Destroying its BrowserWindow would also close healthy siblings.
          if (isGameViewRecord(record)) {
            closeGameViewRecord(id, record);
            return;
          }

          record.window.destroy();
        },
        catch: (cause) => {
          forgetWindow(id);
          return new DesktopWindowError({
            id,
            detail: `Failed to destroy incomplete desktop window: ${kind}`,
            cause,
          });
        },
      }).pipe(
        Effect.catch((cause) =>
          observability.warn(
            "window",
            "Failed to destroy incomplete desktop window",
            { cause, id, kind },
          ),
        ),
      );
    },
  );

  const revealExisting = (id: DesktopWindowInstanceId) => {
    const record = windows.get(id);
    if (record === undefined) {
      forgetWindow(id);
      return Effect.succeed(false);
    }
    if (!isElectronWindowUsable(record.window)) {
      forgetUnusableWindowRecord(id, record);
      return Effect.succeed(false);
    }

    if (isGameViewRecord(record)) {
      const host = findGameHost(record.gameHostRendererId);
      if (host === null) {
        return Effect.succeed(false);
      }
      focusGameViewInHost(host, id);
    }

    return electronWindow.reveal(record.window).pipe(
      Effect.andThen(
        Effect.sync(() => {
          hiddenTopLevelWindowIds.delete(id);
        }),
      ),
      Effect.as(true),
    );
  };

  const reveal: DesktopWindowsShape["reveal"] = (id) =>
    revealExisting(id).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id,
            detail: `Failed to reveal desktop window: ${id}`,
            cause,
          }),
      ),
    );

  const findBrowserWindowEntry = (
    browserWindowId: number,
  ): readonly [DesktopWindowInstanceId, DesktopWindowRecord] | null => {
    for (const entry of windows.entries()) {
      const [id, record] = entry;
      if (record.browserWindowId === browserWindowId) {
        if (
          isElectronWindowUsable(record.window) &&
          (!isGameViewRecord(record) ||
            !record.gameView.webContents.isDestroyed())
        ) {
          return entry;
        }

        forgetUnusableWindowRecord(id, record);
        return null;
      }
    }
    return null;
  };

  const getBrowserWindowId: DesktopWindowsShape["getBrowserWindowId"] = (id) =>
    Effect.sync(() => {
      const record = windows.get(id);
      if (
        record === undefined ||
        !isElectronWindowUsable(record.window) ||
        (isGameViewRecord(record) && record.gameView.webContents.isDestroyed())
      ) {
        throw new Error(`Desktop window is not open: ${id}`);
      }

      return record.browserWindowId;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id,
            detail: `Failed to resolve Electron window id: ${id}`,
            cause,
          }),
      ),
    );

  const getBrowserWindowGroupId: DesktopWindowsShape["getBrowserWindowGroupId"] =
    (browserWindowId) =>
      Effect.try({
        try: () => {
          const entry = findBrowserWindowEntry(browserWindowId);
          if (entry === null) {
            throw new Error(`Desktop renderer is not open: ${browserWindowId}`);
          }
          return entry[1].window.id;
        },
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: `Failed to resolve BrowserWindow group: ${browserWindowId}`,
            id: String(browserWindowId),
          }),
      });

  const getBrowserWindowIds: DesktopWindowsShape["getBrowserWindowIds"] = (
    kind,
  ) =>
    Effect.sync(() =>
      [...windows.values()]
        .filter(
          (record) =>
            record.kind === kind &&
            isElectronWindowUsable(record.window) &&
            (!isGameViewRecord(record) ||
              !record.gameView.webContents.isDestroyed()),
        )
        .map((record) => record.browserWindowId),
    );

  const getBrowserWindowKind: DesktopWindowsShape["getBrowserWindowKind"] = (
    browserWindowId,
  ) =>
    Effect.sync(() => {
      const entry = findBrowserWindowEntry(browserWindowId);
      if (entry !== null) {
        return entry[1].kind;
      }
      if (
        gameGroupControlHosts.has(browserWindowId) &&
        findGameHost(browserWindowId) !== null
      ) {
        return "game-group-controls";
      }
      return findGameHost(browserWindowId) === null ? null : "game-host";
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to resolve Electron window kind: ${browserWindowId}`,
            cause,
          }),
      ),
    );

  const getOwnerBrowserWindowId: DesktopWindowsShape["getOwnerBrowserWindowId"] =
    (browserWindowId) =>
      Effect.sync(() => {
        const entry = findBrowserWindowEntry(browserWindowId);
        if (entry === null) {
          return null;
        }

        const ownerId = entry[1].ownerId;
        if (ownerId === undefined) {
          return null;
        }

        const owner = windows.get(ownerId);
        return owner === undefined || !isElectronWindowUsable(owner.window)
          ? null
          : owner.browserWindowId;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopWindowError({
              id: String(browserWindowId),
              detail: `Failed to resolve Electron window owner: ${browserWindowId}`,
              cause,
            }),
        ),
      );

  const isRendererReady: DesktopWindowsShape["isRendererReady"] = (
    browserWindowId,
  ) =>
    Effect.sync(() => {
      const entry = findBrowserWindowEntry(browserWindowId);
      return entry !== null && entry[1].rendererReady;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to read renderer readiness: ${browserWindowId}`,
            cause,
          }),
      ),
    );

  const getRendererGeneration: DesktopWindowsShape["getRendererGeneration"] = (
    browserWindowId,
  ) =>
    Effect.try({
      try: () => {
        const entry = findBrowserWindowEntry(browserWindowId);
        if (entry === null) {
          throw new Error(`Desktop window is not open: ${browserWindowId}`);
        }
        return entry[1].generation;
      },
      catch: (cause) =>
        new DesktopWindowError({
          id: String(browserWindowId),
          detail: `Failed to read renderer generation: ${browserWindowId}`,
          cause,
        }),
    });

  const markRendererReady: DesktopWindowsShape["markRendererReady"] = (
    browserWindowId,
    generation,
  ) =>
    Effect.gen(function* () {
      const readyEvent = yield* Effect.try({
        try: () => {
          const entry = findBrowserWindowEntry(browserWindowId);
          if (entry === null) {
            throw new Error(`Desktop window is not open: ${browserWindowId}`);
          }

          const [id, record] = entry;
          if (record.generation !== generation) {
            throw new Error(
              `Renderer generation ${generation} is stale; current generation is ${record.generation}.`,
            );
          }
          if (record.rendererReady) {
            return null;
          }

          record.rendererReady = true;
          if (isGameViewRecord(record)) {
            record.gameViewPhase = "ready";
            delete record.gameViewError;
            const host = findGameHost(record.gameHostRendererId);
            if (host !== null) {
              publishGameViewHostState(host);
            }
          }
          return {
            browserWindowId,
            generation: record.generation,
            id,
            kind: record.kind,
          } satisfies DesktopWindowRendererReadyEvent;
        },
        catch: (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to mark renderer ready: ${browserWindowId}`,
            cause,
          }),
      });

      if (readyEvent === null) {
        return;
      }

      yield* Effect.forEach(
        rendererReadyListeners,
        (listener) =>
          listener(readyEvent).pipe(Effect.catch(() => Effect.void)),
        { discard: true },
      );
    });

  const getOwnedBrowserWindowIds: DesktopWindowsShape["getOwnedBrowserWindowIds"] =
    (ownerBrowserWindowId, kind) =>
      Effect.try({
        try: () => {
          const owner = findBrowserWindowEntry(ownerBrowserWindowId);
          if (owner === null) {
            throw new Error(
              `Desktop window owner is not open: ${ownerBrowserWindowId}`,
            );
          }

          const [ownerId] = owner;
          return [...windows.values()]
            .filter(
              (record) =>
                record.ownerId === ownerId &&
                (kind === undefined || record.kind === kind) &&
                isElectronWindowUsable(record.window),
            )
            .map((record) => record.browserWindowId);
        },
        catch: (cause) =>
          new DesktopWindowError({
            id: String(ownerBrowserWindowId),
            detail: `Failed to resolve owned Electron windows: ${ownerBrowserWindowId}`,
            cause,
          }),
      });

  const destroyOwnedWindows = (ownerId: DesktopWindowInstanceId): void => {
    for (const record of windows.values()) {
      if (record.ownerId === ownerId && isElectronWindowUsable(record.window)) {
        record.window.destroy();
      }
    }
  };

  const publishClosed = (
    id: DesktopWindowInstanceId,
    record: DesktopWindowRecord,
  ): void => {
    const event: DesktopWindowClosedEvent = {
      browserWindowId: record.browserWindowId,
      id,
      kind: record.kind,
    };
    for (const listener of closedListeners) {
      void runPromise(listener(event)).catch(() => undefined);
    }
  };

  const closeGameViewRecord = (
    id: DesktopWindowInstanceId,
    record: DesktopGameViewRecord,
  ): void => {
    const host = findGameHost(record.gameHostRendererId);
    const removedIndex = host?.orderedIds.indexOf(id) ?? -1;

    windows.delete(id);
    record.stopObservingFocus();
    record.stopObservingReloads();
    record.stopObservingShortcutInput();
    destroyOwnedWindows(id);

    if (host !== null && isElectronWindowUsable(host.window)) {
      try {
        host.window.removeBrowserView(record.gameView);
      } catch {}
    }
    electronGameView.destroy(record.gameView);
    electronSession.releaseGamePartition(record.gamePartition);
    publishClosed(id, record);

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

    if (host.selectedId === id) {
      host.selectedId =
        host.orderedIds[Math.min(removedIndex, host.orderedIds.length - 1)]!;
    }
    refreshGameViewHost(host);
  };

  const revealBrowserWindow: DesktopWindowsShape["revealBrowserWindow"] = (
    browserWindowId,
  ) =>
    Effect.gen(function* () {
      const entry = findBrowserWindowEntry(browserWindowId);
      if (entry === null) {
        return false;
      }

      return yield* revealExisting(entry[0]);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to reveal Electron window: ${browserWindowId}`,
            cause,
          }),
      ),
    );

  const closeBrowserWindow: DesktopWindowsShape["closeBrowserWindow"] = (
    browserWindowId,
  ) =>
    Effect.sync(() => {
      const entry = findBrowserWindowEntry(browserWindowId);
      if (entry === null) {
        return false;
      }

      const [, record] = entry;
      if (isGameViewRecord(record)) {
        closeGameViewRecord(entry[0], record);
        return true;
      }
      record.window.close();
      return true;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to close Electron window: ${browserWindowId}`,
            cause,
          }),
      ),
    );

  const onClosed: DesktopWindowsShape["onClosed"] = (listener) =>
    Effect.sync(() => {
      closedListeners.add(listener);
      return () => {
        closedListeners.delete(listener);
      };
    });

  const onCreated: DesktopWindowsShape["onCreated"] = (listener) =>
    Effect.sync(() => {
      createdListeners.add(listener);
      return () => {
        createdListeners.delete(listener);
      };
    });

  const onRendererDestroyed: DesktopWindowsShape["onRendererDestroyed"] = (
    listener,
  ) =>
    Effect.sync(() => {
      rendererDestroyedListeners.add(listener);
      return () => {
        rendererDestroyedListeners.delete(listener);
      };
    });

  const onRendererReloaded: DesktopWindowsShape["onRendererReloaded"] = (
    listener,
  ) =>
    Effect.sync(() => {
      rendererReloadedListeners.add(listener);
      return () => {
        rendererReloadedListeners.delete(listener);
      };
    });

  const onRendererReady: DesktopWindowsShape["onRendererReady"] = (listener) =>
    Effect.sync(() => {
      rendererReadyListeners.add(listener);
      return () => {
        rendererReadyListeners.delete(listener);
      };
    });

  const setBackgroundColor: DesktopWindowsShape["setBackgroundColor"] = (
    backgroundColor,
  ) =>
    Effect.forEach(
      windows.entries(),
      ([id, record]) => {
        if (!isElectronWindowUsable(record.window)) {
          forgetUnusableWindowRecord(id, record);
          return Effect.void;
        }

        return Effect.try({
          try: () => {
            record.window.setBackgroundColor(backgroundColor);
            if (isGameViewRecord(record)) {
              record.gameView.setBackgroundColor(backgroundColor);
            }
          },
          catch: (cause) =>
            new DesktopWindowError({
              id,
              detail: `Failed to update desktop window background: ${id}`,
              cause,
            }),
        }).pipe(
          Effect.catch((cause) =>
            observability.warn(
              "window",
              "Failed to update desktop window background",
              { cause, id },
            ),
          ),
        );
      },
      { discard: true },
    );

  const findOpenInstance = (
    kind: DesktopWindowKind,
    ownerId: DesktopWindowInstanceId | undefined,
  ): readonly [DesktopWindowInstanceId, DesktopWindowRecord] | null => {
    for (const entry of windows.entries()) {
      const [, record] = entry;
      if (
        record.kind === kind &&
        record.ownerId === ownerId &&
        isElectronWindowUsable(record.window)
      ) {
        return entry;
      }
    }
    return null;
  };

  const getBootstrapSettings = settings.get.pipe(
    Effect.catch((cause) =>
      observability
        .warn(
          "window",
          "Falling back to default settings for window bootstrap",
          {
            cause,
          },
        )
        .pipe(Effect.as(DEFAULT_APP_SETTINGS)),
    ),
  );

  const updateGameViewPhase = (
    id: DesktopWindowInstanceId,
    phase: GameViewSession["phase"],
    error?: string,
  ): void => {
    const record = windows.get(id);
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
    const host = findGameHost(record.gameHostRendererId);
    if (host !== null) {
      publishGameViewHostState(host);
    }
  };

  const createGameViewInHost = Effect.fn("DesktopWindows.createGameViewInHost")(
    function* (
      host: DesktopGameHostRecord,
      id: DesktopWindowInstanceId,
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

      const gamePartition = yield* electronSession
        .acquireGamePartition(gamePartitionOwner(options))
        .pipe(
          Effect.mapError(
            (cause) =>
              new DesktopWindowError({
                cause,
                detail: "Failed to prepare an isolated Flash session.",
                id,
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
        try: () => host.window.addBrowserView(view),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: "Failed to attach a game view to its host window.",
            id,
          }),
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            electronGameView.destroy(view);
            electronSession.releaseGamePartition(gamePartition);
          }),
        ),
      );

      const browserWindowId = view.webContents.id;
      const gameViewName = normalizeGameViewName(options?.gameViewName);
      const record: DesktopGameViewRecord = {
        browserWindowId,
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
        window: host.window,
      };
      // New tabs follow an existing select-all state, but stay excluded from a
      // user-chosen subset.
      const allViewsTargeted =
        host.groupTargetIds.size === host.orderedIds.length;
      windows.set(id, record);
      host.orderedIds.push(id);
      if (allViewsTargeted) {
        host.groupTargetIds.add(id);
      }
      host.selectedId = id;
      host.layout = usesGameViewGrid(options) ? "grid" : "focused";

      const createdEvent: DesktopWindowCreatedEvent = {
        browserWindowId,
        generation: INITIAL_WINDOW_GENERATION,
        id,
        kind: "game",
      };
      const rendererDestroyedEvent: DesktopWindowRendererDestroyedEvent = {
        browserWindowId,
        id,
        kind: "game",
      };
      record.stopObservingReloads = observeWindowReloads(
        view.webContents,
        (generation) => {
          record.generation = generation;
          record.rendererReady = false;
          updateGameViewPhase(id, "loading");
          const reloadedEvent: DesktopWindowRendererReloadedEvent = {
            browserWindowId,
            generation,
            id,
            kind: "game",
          };
          for (const listener of rendererReloadedListeners) {
            void runPromise(listener(reloadedEvent)).catch(() => undefined);
          }
        },
      );
      const shortcutInputListener = makeGameViewShortcutInputListener(host);
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
        updateGameViewPhase(id, "loading");
      });
      record.stopObservingFocus = electronGameView.onFocus(view, () => {
        activateGameViewInHost(host, id);
        if (host.groupControlsOpen && !host.groupControlsNativeDialogOpen) {
          updateGameGroupControlsOpen(host, false);
        }
      });
      view.webContents.on(
        "did-fail-load",
        (_event, _errorCode, errorDescription, _validatedUrl, isMainFrame) => {
          if (isMainFrame === false) {
            return;
          }
          updateGameViewPhase(id, "error", errorDescription);
        },
      );
      view.webContents.on("render-process-gone", (_event, details) => {
        record.rendererReady = false;
        updateGameViewPhase(
          id,
          "error",
          `Game renderer stopped (${details.reason}).`,
        );
      });
      view.webContents.on("destroyed", () => {
        record.rendererReady = false;
        record.stopObservingFocus();
        record.stopObservingReloads();
        record.stopObservingShortcutInput();
        for (const listener of rendererDestroyedListeners) {
          void runPromise(listener(rendererDestroyedEvent)).catch(
            () => undefined,
          );
        }
      });

      for (const listener of createdListeners) {
        yield* listener(createdEvent).pipe(Effect.catch(() => Effect.void));
      }
      if (options?.onCreated !== undefined) {
        yield* options
          .onCreated(createdEvent)
          .pipe(
            Effect.tapError(() =>
              Effect.sync(() => closeGameViewRecord(id, record)),
            ),
          );
      }

      refreshGameViewHost(host);
      void runPromise(
        electronGameView.loadFile(view, viewHtmlPath("game")).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => {
              updateGameViewPhase(id, "error", cause.message);
            }),
          ),
        ),
      ).catch(() => undefined);

      if (env.debug === true) {
        yield* Effect.try({
          try: () => view.webContents.openDevTools({ mode: "detach" }),
          catch: (cause) =>
            new DesktopWindowError({
              cause,
              detail: `Failed to open game view DevTools: ${id}`,
              id,
            }),
        }).pipe(
          Effect.catch((cause) =>
            observability.warn("window", "Failed to open game view DevTools", {
              cause,
              id,
            }),
          ),
        );
      }
      return id;
    },
  );

  const createMultiGameWindow = Effect.fn(
    "DesktopWindows.createMultiGameWindow",
  )(function* (
    id: DesktopWindowInstanceId,
    definition: DesktopWindowDefinition,
    bootstrapSettings: AppSettings,
    snapshot: AppearanceSnapshot,
    options?: DesktopWindowOpenOptions,
  ) {
    // Auto-grid lays out BrowserViews when game tabs are enabled, not the host.
    const bounds = resolveTileBounds(
      usesGameViewGrid(options) ? undefined : options?.tile,
    );
    const hostDefinition =
      bounds === undefined
        ? {
            ...definition,
            height: definition.height + GAME_VIEW_TAB_BAR_HEIGHT,
          }
        : definition;
    const window = yield* electronWindow.create(
      createWindowOptions(
        env,
        hostDefinition,
        bootstrapSettings,
        snapshot,
        bounds,
        { bridgeView: "game-host", requiresFlashPlugin: false },
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
    // Native BrowserViews sit above the BrowserWindow document, so the tabs
    // and their overflow menu share one persistent view that expands on demand.
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
      try: () => window.addBrowserView(hostView),
      catch: (cause) =>
        new DesktopWindowError({
          cause,
          detail: "Failed to attach the game host view.",
          id,
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
      selectedId: id,
      shortcutModifierPressed: false,
      stopObservingShortcutInput: () => {},
      tabMenuOpen: false,
      window,
    };
    gameHosts.set(host.rendererId, host);
    hostWebContents.once("destroyed", () => {
      gameHosts.delete(host.rendererId);
    });
    const groupControlsRendererId = groupControlsView.webContents.id;
    gameGroupControlHosts.set(groupControlsRendererId, host);
    groupControlsView.webContents.once("destroyed", () => {
      gameGroupControlHosts.delete(groupControlsRendererId);
    });
    const shortcutInputListener = makeGameViewShortcutInputListener(host);
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
        updateGameTabMenuOpen(host, false);
      } catch {}
    });
    window.on("resize", () => {
      if (host.tabMenuOpen) {
        try {
          updateGameTabMenuOpen(host, false);
        } catch {}
      }
      scheduleGameViewHostResize(host);
    });
    window.on("resized", () => finishGameViewHostResize(host));
    window.on("focus", () => publishGameViewPresentations(host));
    window.on("blur", () => {
      publishGameViewPresentations(host);
      setGameViewShortcutModifierPressed(host, false);
      // A parented native file picker temporarily blurs its host window.
      if (host.groupControlsOpen && !host.groupControlsNativeDialogOpen) {
        try {
          updateGameGroupControlsOpen(host, false);
        } catch {}
      }
      if (host.tabMenuOpen) {
        try {
          updateGameTabMenuOpen(host, false);
        } catch {}
      }
    });
    window.once("closed", () => {
      host.closing = true;
      host.stopObservingShortcutInput();
      cancelGameViewHostResize(host);
      cancelGameViewHostRepaint(host);
      gameHosts.delete(host.rendererId);
      gameGroupControlHosts.delete(groupControlsRendererId);

      const closingGameViews = host.orderedIds.flatMap((gameViewId) => {
        const record = windows.get(gameViewId);
        return record !== undefined && isGameViewRecord(record)
          ? [[gameViewId, record] as const]
          : [];
      });
      for (const [gameViewId] of closingGameViews) {
        windows.delete(gameViewId);
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
          void runPromise(
            observability.warn("window", "Failed to clean up game view", {
              cause,
              gameViewId,
              hostRendererId: host.rendererId,
            }),
          ).catch(() => undefined);
        } finally {
          electronSession.releaseGamePartition(record.gamePartition);
        }
        publishClosed(gameViewId, record);
      }
      try {
        electronGameView.destroy(groupControlsView);
      } catch (cause) {
        void runPromise(
          observability.warn("window", "Failed to clean up group controls", {
            cause,
            hostRendererId: host.rendererId,
          }),
        ).catch(() => undefined);
      }
      try {
        electronGameView.destroy(hostView);
      } catch (cause) {
        void runPromise(
          observability.warn("window", "Failed to clean up game host", {
            cause,
            hostRendererId: host.rendererId,
          }),
        ).catch(() => undefined);
      }

      quitIfNoTopLevelWindow();
    });

    return yield* Effect.gen(function* () {
      yield* createGameViewInHost(
        host,
        id,
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
      const initialGameView = windows.get(id);
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
      yield* observability.info("window", "Multi-game window opened", {
        hostRendererId: host.rendererId,
        id,
      });
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
        const host = findGameHost(hostRendererId);
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
  ) => requireGameHost(hostRendererId).pipe(Effect.map(gameViewHostState));

  const setGameViewTabMenuOpen: DesktopWindowsShape["setGameViewTabMenuOpen"] =
    (hostRendererId, open) =>
      Effect.gen(function* () {
        const host = yield* requireGameHost(hostRendererId);
        yield* Effect.try({
          try: () => {
            if (open && host.groupControlsOpen) {
              updateGameGroupControlsOpen(host, false);
            }
            updateGameTabMenuOpen(host, open);
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
      yield* createGameViewInHost(
        host,
        makeInstanceId("game"),
        bootstrapSettings,
        snapshot,
      );
      return gameViewHostState(host);
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
      const record = windows.get(id);
      if (
        record === undefined ||
        !isGameViewRecord(record) ||
        record.gameHostRendererId !== host.rendererId
      ) {
        return yield* new DesktopWindowError({
          detail: `Game view does not belong to this host: ${id}`,
          id,
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
          id,
        });
      }

      yield* Effect.try({
        try: () => selectGameViewInHost(host, id, focus),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: `Failed to select game view: ${id}`,
            id,
          }),
      });
      return gameViewHostState(host);
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
        return gameViewHostState(host);
      }

      host.orderedIds.splice(0, host.orderedIds.length, ...ids);
      yield* Effect.try({
        try: () => refreshGameViewHost(host),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: "Failed to reorder game views.",
            id: String(hostRendererId),
          }),
      });
      return gameViewHostState(host);
    });

  const setGameViewLayout: DesktopWindowsShape["setGameViewLayout"] = (
    hostRendererId,
    layout,
  ) =>
    Effect.gen(function* () {
      const host = yield* requireGameHost(hostRendererId);
      if (host.layout === layout) {
        return gameViewHostState(host);
      }
      host.layout = layout;
      yield* Effect.try({
        try: () => refreshGameViewHost(host),
        catch: (cause) =>
          new DesktopWindowError({
            cause,
            detail: `Failed to use ${layout} game view layout.`,
            id: String(hostRendererId),
          }),
      });
      return gameViewHostState(host);
    });

  const setGameViewGroupControlsOpen: DesktopWindowsShape["setGameViewGroupControlsOpen"] =
    (hostRendererId, open) =>
      Effect.gen(function* () {
        const host = yield* requireGameHost(hostRendererId);
        yield* Effect.try({
          try: () => updateGameGroupControlsOpen(host, open),
          catch: (cause) =>
            new DesktopWindowError({
              cause,
              detail: `Failed to ${open ? "open" : "close"} group controls.`,
              id: String(hostRendererId),
            }),
        });
        return gameViewHostState(host);
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
                host.window.setTopBrowserView(host.groupControlsView);
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
          return gameViewHostState(host);
        }

        host.groupTargetIds.clear();
        for (const id of orderedIds) host.groupTargetIds.add(id);
        publishGameViewHostState(host);
        return gameViewHostState(host);
      });

  const activateGameView: DesktopWindowsShape["activateGameView"] = (
    gameRendererId,
  ) =>
    Effect.try({
      try: () => {
        const entry = findBrowserWindowEntry(gameRendererId);
        if (entry === null || entry[1].kind !== "game") {
          throw new Error(`Game renderer is not open: ${gameRendererId}`);
        }
        const [id, record] = entry;
        if (!isGameViewRecord(record)) {
          return standaloneGameViewPresentation(record.window);
        }
        const host = findGameHost(record.gameHostRendererId);
        if (host === null) {
          throw new Error(`Game view host is not open: ${gameRendererId}`);
        }
        activateGameViewInHost(host, id);
        return gameViewPresentation(host, id);
      },
      catch: (cause) =>
        new DesktopWindowError({
          cause,
          detail: `Failed to activate game view: ${gameRendererId}`,
          id: String(gameRendererId),
        }),
    });

  const getGameViewPresentation: DesktopWindowsShape["getGameViewPresentation"] =
    (gameRendererId) =>
      Effect.try({
        try: () => {
          const entry = findBrowserWindowEntry(gameRendererId);
          if (entry === null || entry[1].kind !== "game") {
            throw new Error(`Game renderer is not open: ${gameRendererId}`);
          }
          const [id, record] = entry;
          if (!isGameViewRecord(record)) {
            return standaloneGameViewPresentation(record.window);
          }
          const host = findGameHost(record.gameHostRendererId);
          if (host === null) {
            throw new Error(`Game view host is not open: ${gameRendererId}`);
          }
          return gameViewPresentation(host, id);
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
        const entry = findBrowserWindowEntry(gameRendererId);
        if (entry === null || entry[1].kind !== "game") {
          throw new Error(`Game renderer is not open: ${gameRendererId}`);
        }
        const [, record] = entry;
        if (!isGameViewRecord(record)) {
          return;
        }
        const gameViewName = normalizeGameViewName(name);
        if (record.gameViewName === gameViewName) {
          return;
        }
        if (gameViewName === undefined) {
          delete record.gameViewName;
        } else {
          record.gameViewName = gameViewName;
        }
        const host = findGameHost(record.gameHostRendererId);
        if (host !== null) {
          publishGameViewHostState(host);
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
            if (options?.ownerBrowserWindowId !== undefined) {
              throw new Error(
                `${kind} does not accept a logical owner window.`,
              );
            }
            return undefined;
          }

          if (options?.ownerBrowserWindowId === undefined) {
            throw new Error(`${kind} requires an owning game window.`);
          }

          const owner = findBrowserWindowEntry(options.ownerBrowserWindowId);
          if (
            owner === null ||
            owner[1].kind !== "game" ||
            owner[1].ownerId !== undefined
          ) {
            throw new Error(
              `The owning window must be an open root game: ${options.ownerBrowserWindowId}`,
            );
          }

          return owner[0];
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
          const [id] = existing;
          yield* revealExisting(id);
          return id;
        }
      }

      const id = makeInstanceId(kind);
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
        if (definition.requiresFlashPlugin) {
          yield* electronSession.prepareGameNetworking;
        }

        if (kind === "game" && bootstrapSettings.preferences.groupGameViews) {
          if (
            options?.reuseGameHost === true &&
            (options.tile === undefined || usesGameViewGrid(options))
          ) {
            const availableHost = [...gameHosts.values()].find(
              (host) =>
                findGameHost(host.rendererId) !== null &&
                host.orderedIds.length < MAX_GAME_VIEWS_PER_WINDOW,
            );
            if (availableHost !== undefined) {
              yield* createGameViewInHost(
                availableHost,
                id,
                bootstrapSettings,
                snapshot,
                options,
              );
              yield* electronWindow.reveal(availableHost.window);
              return id;
            }
          }

          return yield* createMultiGameWindow(
            id,
            definition,
            bootstrapSettings,
            snapshot,
            options,
          );
        }

        const bounds = resolveTileBounds(options?.tile);
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
              bounds,
              gamePartition === undefined
                ? undefined
                : {
                    bridgeView: "game",
                    partition: gamePartition,
                    requiresFlashPlugin: true,
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
        const browserWindowId = webContents.id;
        const record: DesktopWindowRecord = {
          browserWindowId,
          generation: INITIAL_WINDOW_GENERATION,
          kind,
          ...(gamePartition === undefined ? {} : { gamePartition }),
          ...(ownerId === undefined ? {} : { ownerId }),
          rendererReady: false,
          window,
        };
        windows.set(id, record);
        if (kind === "game" && !isGameViewRecord(record)) {
          window.on("focus", () =>
            publishStandaloneGameViewPresentation(record),
          );
          window.on("blur", () =>
            publishStandaloneGameViewPresentation(record),
          );
        }
        const createdEvent: DesktopWindowCreatedEvent = {
          browserWindowId,
          generation: INITIAL_WINDOW_GENERATION,
          id,
          kind,
        };
        const rendererDestroyedEvent: DesktopWindowRendererDestroyedEvent = {
          browserWindowId,
          id,
          kind,
        };
        const stopObservingWindowReloads = observeWindowReloads(
          webContents,
          (generation) => {
            record.generation = generation;
            record.rendererReady = false;
            const reloadedEvent: DesktopWindowRendererReloadedEvent = {
              browserWindowId,
              generation,
              id,
              kind,
            };
            for (const listener of rendererReloadedListeners) {
              void runPromise(listener(reloadedEvent)).catch(() => undefined);
            }
          },
        );

        webContents.on("destroyed", () => {
          record.rendererReady = false;
          stopObservingWindowReloads();
          for (const listener of rendererDestroyedListeners) {
            void runPromise(listener(rendererDestroyedEvent)).catch(
              () => undefined,
            );
          }
        });

        if (definition.closeBehavior === "hide") {
          window.on("close", (event) => {
            if (appIsQuitting || window.isDestroyed()) {
              return;
            }

            preventWindowClose(event);
            window.hide();
            if (isTopLevelWindow) {
              hiddenTopLevelWindowIds.add(id);
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
            browserWindowId,
            id,
            kind,
          };
          forgetWindow(id);
          for (const record of windows.values()) {
            if (
              record.ownerId === id &&
              isElectronWindowUsable(record.window)
            ) {
              record.window.destroy();
            }
          }
          for (const listener of closedListeners) {
            void runPromise(listener(closedEvent)).catch(() => undefined);
          }
          if (isTopLevelWindow) {
            quitIfNoTopLevelWindow();
          }
        });

        for (const listener of createdListeners) {
          yield* listener(createdEvent).pipe(Effect.catch(() => Effect.void));
        }

        if (options?.onCreated !== undefined) {
          yield* options.onCreated(createdEvent);
        }

        yield* electronWindow.loadFile(window, viewHtmlPath(definition.kind));
        if (env.debug === true) {
          yield* Effect.try({
            try: () => webContents.openDevTools({ mode: "detach" }),
            catch: (cause) =>
              new DesktopWindowError({
                id,
                detail: `Failed to open DevTools for desktop window: ${id}`,
                cause,
              }),
          }).pipe(
            Effect.catch((cause) =>
              observability.warn("window", "Failed to open DevTools", {
                cause,
                id,
                kind,
              }),
            ),
          );
        }
        yield* electronWindow.reveal(window);
        if (isTopLevelWindow) {
          hiddenTopLevelWindowIds.delete(id);
          hasOpenedTopLevelWindow = true;
        }
        yield* observability.info("window", "Desktop window opened", {
          id,
          kind,
        });
        return id;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopWindowError({
              id,
              detail: `Failed to open desktop window: ${kind}`,
              cause,
            }),
        ),
        Effect.onError(() => destroyFailedWindow(id, kind)),
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
        const [accountManagerId] = accountManager;
        if (yield* revealExisting(accountManagerId)) {
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
      void runPromise(
        restorePrimaryWindow().pipe(
          Effect.catch((cause) =>
            observability.warn(
              "window",
              "Failed to restore a primary window after macOS activation",
              { cause },
            ),
          ),
        ),
      ).catch(() => undefined);
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribeActivate));
  }

  return DesktopWindows.of({
    activateGameView,
    addGameView,
    closeBrowserWindow,
    closeGameView,
    getBrowserWindowIds,
    getBrowserWindowId,
    getBrowserWindowGroupId,
    getBrowserWindowKind,
    getGameViewHostState,
    getGameViewPresentation,
    getOwnedBrowserWindowIds,
    getOwnerBrowserWindowId,
    getRendererGeneration,
    isRendererReady,
    markRendererReady,
    onClosed,
    onCreated,
    onRendererDestroyed,
    onRendererReloaded,
    onRendererReady,
    open,
    reveal,
    revealBrowserWindow,
    retireManagedGameProfile: (key) =>
      electronSession.retireManagedGameProfile(key).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopWindowError({
              cause,
              detail: "Failed to retire managed game profile.",
              id: "game-profile",
            }),
        ),
      ),
    reorderGameViews,
    selectGameView,
    setBackgroundColor,
    setGameViewGroupControlsOpen,
    setGameViewGroupTargets,
    setGameViewLayout,
    setGameViewName,
    setGameViewTabMenuOpen,
    withGameViewGroupControlsNativeDialog,
  });
});

export const layer = Layer.effect(DesktopWindows, makeDesktopWindows);
