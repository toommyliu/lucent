import type { Event as ElectronEvent, Input } from "electron";
import type * as Scope from "effect/Scope";

import {
  MAX_GAME_VIEWS_PER_WINDOW,
  gameViewFallbackName,
  scaledGameViewTabBarHeight,
  type GameViewHostState,
  type GameViewLayout,
  type GameViewPresentation,
  type GameViewSelectionFocus,
  type GameViewSession,
} from "../../shared/gameViews";
import { GameViewsIpc } from "../../shared/ipc";
import type { ElectronGameViewHandle } from "../electron/ElectronGameView";
import {
  isElectronWindowUsable,
  type ElectronNativeWindowHandle,
} from "../electron/ElectronWindow";
import { focusedGameViewBounds, gridGameViewBounds } from "./GameViewLayout";
import {
  readGameViewShortcutIndex,
  readGameViewShortcutModifierHintUpdate,
} from "./GameViewShortcuts";

const GAME_VIEW_RESIZE_SETTLE_DELAY_MS = 100;
const GAME_GROUP_CONTROLS_HEIGHT = 408;
const GAME_GROUP_CONTROLS_MARGIN = 8;
const GAME_GROUP_CONTROLS_WIDTH = 392;

export interface DesktopGameViewRecord {
  /** The layout whose bounds this view has, which can differ from its host's. */
  boundsLayout: GameViewLayout;
  readonly gameHostRendererId: number;
  readonly scope: Scope.Closeable;
  readonly gameView: ElectronGameViewHandle;
  gameViewError?: string;
  gameViewName?: string;
  gameViewPhase: GameViewSession["phase"];
  generation: number;
  readonly hostWindow: ElectronNativeWindowHandle;
  readonly kind: "game";
  loggedInUsername?: string;
  readonly ownerId?: number;
  publishedPresentation?: GameViewPresentation;
  readonly rendererId: number;
  rendererReady: boolean;
  /** Rejects delayed readiness from a failed generation until navigation advances it. */
  /** Rejects delayed readiness from a failed generation until navigation advances it. */
  unavailableGeneration?: number;
}

export interface DesktopGameHostRecord {
  readonly scope: Scope.Closeable;
  nativeCloseRequested?: true;
  groupControlsNativeDialogOpen: boolean;
  readonly groupControlsView: ElectronGameViewHandle;
  groupControlsOpen: boolean;
  readonly groupTargetIds: Set<number>;
  readonly hostView: ElectronGameViewHandle;
  readonly rendererId: number;
  layout: GameViewLayout;
  readonly orderedIds: number[];
  resizeSettleTimer?: ReturnType<typeof setTimeout>;
  selectedId: number;
  shortcutModifierPressed: boolean;
  stackedGameViewId?: number;
  tabMenuOpen: boolean;
  readonly window: ElectronNativeWindowHandle;
}

interface DesktopGameHostsOptions {
  readonly getGameViewRecord: (id: number) => DesktopGameViewRecord | undefined;
  readonly onStateChanged: (host: DesktopGameHostRecord) => void;
  readonly platform: NodeJS.Platform;
}

/** Normalizes the optional label displayed for a hosted game view. */
export const normalizeGameViewName = (
  value: string | undefined,
): string | undefined => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === ""
    ? undefined
    : normalized.slice(0, 64);
};

const sameGameViewPresentation = (
  left: GameViewPresentation,
  right: GameViewPresentation,
): boolean =>
  left.active === right.active &&
  left.layout === right.layout &&
  left.tiled === right.tiled &&
  left.windowActive === right.windowActive;

export const parseGameViewTabId = (id: string): number => {
  const rendererId = Number(id);
  return Number.isSafeInteger(rendererId) &&
    rendererId > 0 &&
    String(rendererId) === id
    ? rendererId
    : Number.NaN;
};

const gameViewSession = (
  id: number,
  record: DesktopGameViewRecord,
  index: number,
): GameViewSession => ({
  id: String(id),
  name: record.gameViewName ?? gameViewFallbackName(index),
  phase: record.gameViewPhase,
  ...(record.gameViewError === undefined
    ? {}
    : { error: record.gameViewError }),
});

const gameViewPresentation = (
  host: DesktopGameHostRecord,
  id: number,
  boundsLayout: GameViewLayout,
): GameViewPresentation => ({
  active: host.selectedId === id,
  layout: host.layout,
  tiled: boundsLayout === "grid",
  windowActive: host.window.isFocused(),
});

const gameGroupControlsBounds = (
  width: number,
  height: number,
  topInset: number,
): {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
} => {
  const availableWidth = Math.max(1, width - GAME_GROUP_CONTROLS_MARGIN * 2);
  const availableHeight = Math.max(
    1,
    height - topInset - GAME_GROUP_CONTROLS_MARGIN * 2,
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
    y: topInset + GAME_GROUP_CONTROLS_MARGIN,
  };
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

const cancelResize = (host: DesktopGameHostRecord): void => {
  if (host.resizeSettleTimer === undefined) return;
  clearTimeout(host.resizeSettleTimer);
  delete host.resizeSettleTimer;
};

const setShortcutModifierPressed = (
  host: DesktopGameHostRecord,
  pressed: boolean,
): void => {
  if (host.shortcutModifierPressed === pressed) return;
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

export const makeDesktopGameHosts = (options: DesktopGameHostsOptions) => {
  const state = (host: DesktopGameHostRecord): GameViewHostState => ({
    capacity: MAX_GAME_VIEWS_PER_WINDOW,
    groupControlsOpen: host.groupControlsOpen,
    groupTargetIds: host.orderedIds
      .filter((id) => host.groupTargetIds.has(id))
      .map(String),
    layout: host.layout,
    selectedId: String(host.selectedId),
    sessions: host.orderedIds.flatMap((id, index) => {
      const record = options.getGameViewRecord(id);
      return record === undefined ? [] : [gameViewSession(id, record, index)];
    }),
  });

  const applyGroupControlsLayout = (
    host: DesktopGameHostRecord,
    width: number,
    height: number,
    topInset: number,
  ): void => {
    if (!host.groupControlsOpen) return;
    setGameViewBounds(
      host.groupControlsView,
      gameGroupControlsBounds(width, height, topInset),
    );
    host.window.contentView.addChildView(host.groupControlsView.native);
  };

  const applyHostViewLayout = (
    host: DesktopGameHostRecord,
    width: number,
    height: number,
    topInset: number,
  ): void => {
    setGameViewBounds(host.hostView, {
      height: host.tabMenuOpen ? Math.max(1, height) : topInset,
      width: Math.max(1, width),
      x: 0,
      y: 0,
    });
    host.window.contentView.addChildView(host.hostView.native);
  };

  const applyLayout = (host: DesktopGameHostRecord): void => {
    if (!isElectronWindowUsable(host.window)) return;

    const { height, width } = host.window.getContentBounds();
    const topInset = scaledGameViewTabBarHeight(
      host.hostView.webContents.getZoomFactor(),
    );
    if (host.layout === "focused") {
      const selected = options.getGameViewRecord(host.selectedId);
      if (selected !== undefined) {
        selected.boundsLayout = "focused";
        if (host.stackedGameViewId !== host.selectedId) {
          host.window.contentView.addChildView(selected.gameView.native);
          host.stackedGameViewId = host.selectedId;
        }
      }
    } else {
      for (const id of host.orderedIds) {
        const record = options.getGameViewRecord(id);
        if (record !== undefined) record.boundsLayout = "grid";
      }
    }

    // Inactive views keep their last size behind the selected view, and a
    // hidden tile keeps its bounds until the grid shows it. A resized view
    // redraws everything at its new size, and views resized together compete
    // for the GPU.
    const focusedBounds = focusedGameViewBounds(width, height, topInset);
    for (const [index, id] of host.orderedIds.entries()) {
      const record = options.getGameViewRecord(id);
      if (record === undefined) continue;
      if (host.layout === "focused" && record.boundsLayout === "grid") continue;
      setGameViewBounds(
        record.gameView,
        record.boundsLayout === "focused"
          ? focusedBounds
          : gridGameViewBounds(
              width,
              height,
              topInset,
              index,
              host.orderedIds.length,
            ),
      );
    }

    applyGroupControlsLayout(host, width, height, topInset);
    applyHostViewLayout(host, width, height, topInset);
    publishPresentations(host);
  };

  const finishResize = (host: DesktopGameHostRecord): void => {
    cancelResize(host);
    if (host.scope.state._tag === "Closed" || host.nativeCloseRequested) return;

    try {
      applyLayout(host);
    } catch {}
  };

  const scheduleResize = (host: DesktopGameHostRecord): void => {
    if (host.scope.state._tag === "Closed" || host.nativeCloseRequested) return;

    if (host.resizeSettleTimer !== undefined) {
      clearTimeout(host.resizeSettleTimer);
    }
    // Some window managers omit Electron's `resized` event.
    host.resizeSettleTimer = setTimeout(
      () => finishResize(host),
      GAME_VIEW_RESIZE_SETTLE_DELAY_MS,
    );
  };

  const presentation = (
    host: DesktopGameHostRecord,
    id: number,
  ): GameViewPresentation =>
    gameViewPresentation(
      host,
      id,
      options.getGameViewRecord(id)?.boundsLayout ?? host.layout,
    );

  const publishPresentations = (host: DesktopGameHostRecord): void => {
    for (const id of host.orderedIds) {
      const record = options.getGameViewRecord(id);
      if (record === undefined || record.gameView.webContents.isDestroyed()) {
        continue;
      }
      const nextPresentation = presentation(host, id);
      if (
        record.publishedPresentation !== undefined &&
        sameGameViewPresentation(record.publishedPresentation, nextPresentation)
      ) {
        continue;
      }
      record.publishedPresentation = nextPresentation;
      record.gameView.webContents.send(
        GameViewsIpc.presentationChanged.channel,
        nextPresentation,
      );
    }
  };

  const publishState = (host: DesktopGameHostRecord): void => {
    if (!isElectronWindowUsable(host.window)) return;

    const nextState = state(host);
    if (!host.hostView.webContents.isDestroyed()) {
      host.hostView.webContents.send(GameViewsIpc.changed.channel, nextState);
    }
    if (!host.groupControlsView.webContents.isDestroyed()) {
      host.groupControlsView.webContents.send(
        GameViewsIpc.changed.channel,
        nextState,
      );
    }
    publishPresentations(host);
    options.onStateChanged(host);
  };

  const refresh = (host: DesktopGameHostRecord): void => {
    cancelResize(host);
    applyLayout(host);
    publishState(host);
  };

  const activate = (host: DesktopGameHostRecord, id: number): void => {
    if (host.selectedId === id) return;
    host.selectedId = id;
    publishState(host);
  };

  const setTabMenuOpen = (host: DesktopGameHostRecord, open: boolean): void => {
    if (host.tabMenuOpen === open) return;
    const previousOpen = host.tabMenuOpen;
    host.tabMenuOpen = open;
    try {
      applyLayout(host);
    } catch (cause) {
      host.tabMenuOpen = previousOpen;
      try {
        applyLayout(host);
      } catch {}
      throw cause;
    }
    if (open && !host.hostView.webContents.isDestroyed()) {
      try {
        host.hostView.webContents.focus();
      } catch {}
    }
    if (!host.hostView.webContents.isDestroyed()) {
      try {
        host.hostView.webContents.send(
          GameViewsIpc.tabMenuOpenChanged.channel,
          host.tabMenuOpen,
        );
      } catch {}
    }
  };

  const setGroupControlsOpen = (
    host: DesktopGameHostRecord,
    open: boolean,
  ): void => {
    if (host.groupControlsOpen === open) return;
    if (open && host.tabMenuOpen) setTabMenuOpen(host, false);
    if (open) {
      host.window.contentView.addChildView(host.groupControlsView.native);
    } else {
      host.window.contentView.removeChildView(host.groupControlsView.native);
    }
    host.groupControlsOpen = open;
    if (!open) delete host.stackedGameViewId;
    refresh(host);
    if (open && !host.groupControlsView.webContents.isDestroyed()) {
      host.groupControlsView.webContents.focus();
      return;
    }

    const selected = options.getGameViewRecord(host.selectedId);
    if (
      !open &&
      selected !== undefined &&
      !selected.gameView.webContents.isDestroyed()
    ) {
      selected.gameView.webContents.focus();
    }
  };

  const select = (
    host: DesktopGameHostRecord,
    id: number,
    focus: GameViewSelectionFocus,
  ): void => {
    const record = options.getGameViewRecord(id);
    if (record === undefined || record.gameHostRendererId !== host.rendererId) {
      throw new Error(`Game view does not belong to this host: ${id}`);
    }

    if (host.selectedId !== id || host.layout !== "focused") {
      host.selectedId = id;
      host.layout = "focused";
      refresh(host);
    }
    if (focus === "host") {
      if (!host.hostView.webContents.isDestroyed()) {
        host.hostView.webContents.focus();
      }
    } else if (!record.gameView.webContents.isDestroyed()) {
      record.gameView.webContents.focus();
    }
  };

  const focus = (host: DesktopGameHostRecord, id: number): void =>
    select(host, id, "view");

  const makeShortcutInputListener =
    (
      host: DesktopGameHostRecord,
    ): ((event: ElectronEvent, input: Input) => void) =>
    (event, input) => {
      const modifierHintUpdate = readGameViewShortcutModifierHintUpdate(
        input,
        options.platform,
      );
      if (modifierHintUpdate !== null) {
        setShortcutModifierPressed(host, modifierHintUpdate);
      }

      const index = readGameViewShortcutIndex(
        input,
        options.platform,
        host.orderedIds.length,
      );
      if (index === null) return;
      const id = host.orderedIds[index];
      if (id === undefined) return;

      event.preventDefault();
      focus(host, id);
    };

  return {
    activate,
    cancelResize,
    finishResize,
    focus,
    makeShortcutInputListener,
    presentation,
    publishPresentations,
    publishState,
    refresh,
    scheduleResize,
    select,
    setGroupControlsOpen,
    setShortcutModifierPressed,
    setTabMenuOpen,
    syncTabBarLayout: applyLayout,
    state,
  };
};
