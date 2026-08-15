import type { Event as ElectronEvent, Input } from "electron";

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
import type { ElectronGameViewHandle } from "../electron/ElectronGameView";
import {
  isElectronWindowUsable,
  type ElectronWindowHandle,
} from "../electron/ElectronWindow";
import { focusedGameViewBounds, gridGameViewBounds } from "./GameViewLayout";
import {
  readGameViewShortcutIndex,
  readGameViewShortcutModifierHintUpdate,
} from "./GameViewShortcuts";
import type { DesktopWindowInstanceId } from "./DesktopWindows";

const GAME_VIEW_RESIZE_SETTLE_DELAY_MS = 100;
const GAME_GROUP_CONTROLS_HEIGHT = 408;
const GAME_GROUP_CONTROLS_MARGIN = 8;
const GAME_GROUP_CONTROLS_WIDTH = 392;

export interface DesktopGameViewRecord {
  readonly gameHostRendererId: number;
  readonly gamePartition: string;
  readonly gameView: ElectronGameViewHandle;
  gameViewError?: string;
  gameViewName?: string;
  gameViewPhase: GameViewSession["phase"];
  generation: number;
  readonly hostWindow: ElectronWindowHandle;
  readonly kind: "game";
  readonly ownerId?: DesktopWindowInstanceId;
  publishedPresentation?: GameViewPresentation;
  readonly rendererId: number;
  rendererReady: boolean;
  stopObservingFocus: () => void;
  stopObservingReloads: () => void;
  stopObservingShortcutInput: () => void;
}

export interface DesktopGameHostRecord {
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

interface DesktopGameHostsOptions {
  readonly getGameViewRecord: (
    id: DesktopWindowInstanceId,
  ) => DesktopGameViewRecord | undefined;
  readonly onShortcutError: (details: {
    readonly cause: unknown;
    readonly hostRendererId: number;
    readonly id: DesktopWindowInstanceId;
  }) => void;
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
  left.windowActive === right.windowActive;

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

const cancelRepaint = (host: DesktopGameHostRecord): void => {
  if (host.repaintTimer === undefined) return;
  clearTimeout(host.repaintTimer);
  delete host.repaintTimer;
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

/** Owns the mutable mechanics shared by grouped game hosts. */
export const makeDesktopGameHosts = (options: DesktopGameHostsOptions) => {
  const hosts = new Map<number, DesktopGameHostRecord>();
  const groupControlHosts = new Map<number, DesktopGameHostRecord>();

  const find = (rendererId: number): DesktopGameHostRecord | null => {
    const host = hosts.get(rendererId) ?? groupControlHosts.get(rendererId);
    if (
      host === undefined ||
      host.closing ||
      !isElectronWindowUsable(host.window) ||
      host.groupControlsView.webContents.isDestroyed() ||
      host.hostView.webContents.isDestroyed()
    ) {
      if (host !== undefined) {
        hosts.delete(host.rendererId);
        groupControlHosts.delete(host.groupControlsView.webContents.id);
      }
      return null;
    }
    return host;
  };

  const state = (host: DesktopGameHostRecord): GameViewHostState => ({
    capacity: MAX_GAME_VIEWS_PER_WINDOW,
    groupControlsOpen: host.groupControlsOpen,
    groupTargetIds: host.orderedIds.filter((id) => host.groupTargetIds.has(id)),
    layout: host.layout,
    selectedId: host.selectedId,
    sessions: host.orderedIds.flatMap((id, index) => {
      const record = options.getGameViewRecord(id);
      return record === undefined ? [] : [gameViewSession(id, record, index)];
    }),
  });

  const applyGroupControlsLayout = (
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

  const applyHostViewLayout = (
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

  const applyLayout = (host: DesktopGameHostRecord): void => {
    if (!isElectronWindowUsable(host.window)) return;

    const { height, width } = host.window.getContentBounds();
    const topInset = GAME_VIEW_TAB_BAR_HEIGHT;
    if (host.layout === "focused") {
      const bounds = focusedGameViewBounds(width, height, topInset);
      const selected = options.getGameViewRecord(host.selectedId);
      if (selected !== undefined) {
        setGameViewBounds(selected.gameView, bounds);
        if (host.stackedGameViewId !== host.selectedId) {
          host.window.setTopBrowserView(selected.gameView);
          host.stackedGameViewId = host.selectedId;
        }
      }

      // Keep inactive views at their final focused size behind the selected
      // view. Tab changes then only alter native stacking order.
      for (const id of host.orderedIds) {
        if (id === host.selectedId) continue;
        const record = options.getGameViewRecord(id);
        if (record !== undefined) setGameViewBounds(record.gameView, bounds);
      }
    } else {
      for (const [index, id] of host.orderedIds.entries()) {
        const record = options.getGameViewRecord(id);
        if (record !== undefined) {
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
    }

    applyGroupControlsLayout(host, width, height);
    applyHostViewLayout(host, width, height);
  };

  const repaint = (host: DesktopGameHostRecord): void => {
    if (!isElectronWindowUsable(host.window)) return;

    if (!host.hostView.webContents.isDestroyed()) {
      host.hostView.webContents.invalidate();
    }
    const visibleIds =
      host.layout === "focused" ? [host.selectedId] : host.orderedIds;
    for (const id of visibleIds) {
      const record = options.getGameViewRecord(id);
      if (record !== undefined && !record.gameView.webContents.isDestroyed()) {
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

  const scheduleRepaint = (host: DesktopGameHostRecord): void => {
    cancelRepaint(host);
    host.repaintTimer = setTimeout(() => {
      delete host.repaintTimer;
      repaint(host);
    }, 16);
  };

  const finishResize = (host: DesktopGameHostRecord): void => {
    cancelResize(host);
    cancelRepaint(host);
    if (host.closing) return;

    try {
      applyLayout(host);
      repaint(host);
    } catch {}
  };

  const scheduleResize = (host: DesktopGameHostRecord): void => {
    if (host.closing) return;

    cancelRepaint(host);
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
    id: DesktopWindowInstanceId,
  ): GameViewPresentation => gameViewPresentation(host, id);

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
  };

  const refresh = (host: DesktopGameHostRecord): void => {
    cancelResize(host);
    applyLayout(host);
    publishState(host);
    scheduleRepaint(host);
  };

  const activate = (
    host: DesktopGameHostRecord,
    id: DesktopWindowInstanceId,
  ): void => {
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
    scheduleRepaint(host);
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
      host.window.addBrowserView(host.groupControlsView);
    } else {
      host.window.removeBrowserView(host.groupControlsView);
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
    id: DesktopWindowInstanceId,
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

  const focus = (
    host: DesktopGameHostRecord,
    id: DesktopWindowInstanceId,
  ): void => select(host, id, "view");

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
      try {
        focus(host, id);
      } catch (cause) {
        options.onShortcutError({ cause, hostRendererId: host.rendererId, id });
      }
    };

  const register = (host: DesktopGameHostRecord): void => {
    hosts.set(host.rendererId, host);
    groupControlHosts.set(host.groupControlsView.webContents.id, host);
  };

  const unregister = (host: DesktopGameHostRecord): void => {
    hosts.delete(host.rendererId);
    groupControlHosts.delete(host.groupControlsView.webContents.id);
  };

  return {
    activate,
    cancelRepaint,
    cancelResize,
    find,
    finishResize,
    focus,
    hasGroupControlsRenderer: (rendererId: number) =>
      groupControlHosts.has(rendererId),
    makeShortcutInputListener,
    presentation,
    publishPresentations,
    publishState,
    refresh,
    register,
    scheduleResize,
    select,
    setGroupControlsOpen,
    setShortcutModifierPressed,
    setTabMenuOpen,
    state,
    unregister,
    values: () => hosts.values(),
  };
};
