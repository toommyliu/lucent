import type { Event as ElectronEvent, Input } from "electron";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Scope from "effect/Scope";
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
import {
  forkWebContentsScope,
  observeElectronEvent,
} from "../electron/ElectronScope";
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
import type {
  DesktopWindowSession,
  DesktopWindowSessions,
} from "./DesktopWindowSession";
import { awaitWindowCreation } from "./DesktopWindowSession";
import type {
  DesktopWindowResources,
  WindowBootstrap,
} from "./DesktopWindowResources";
import type { DesktopWindowOpenOptions } from "./DesktopWindows";
import { DesktopWindowError } from "./DesktopWindowError";

const GAME_VIEW_RESIZE_SETTLE_DELAY_MS = 100;
const GAME_GROUP_CONTROLS_HEIGHT = 408;
const GAME_GROUP_CONTROLS_MARGIN = 8;
const GAME_GROUP_CONTROLS_WIDTH = 392;

interface GameView {
  readonly session: DesktopWindowSession;
  readonly gameView: ElectronGameViewHandle;
  boundsLayout: GameViewLayout;
  publishedPresentation?: GameViewPresentation;
}

interface GameHost {
  readonly scope: Scope.Closeable;
  readonly closing: boolean;
  readonly views: Map<string, GameView>;
  readonly window: ElectronNativeWindowHandle;
  readonly hostView: ElectronGameViewHandle;
  readonly groupControlsView: ElectronGameViewHandle;
  readonly rendererId: number;
  readonly orderedIds: string[];
  readonly groupTargetIds: Set<string>;
  layout: GameViewLayout;
  selectedId: string;
  groupControlsNativeDialogOpen: boolean;
  groupControlsOpen: boolean;
  tabMenuOpen: boolean;
  shortcutModifierPressed: boolean;
  resizeSettleTimer?: ReturnType<typeof setTimeout>;
  stackedGameViewId?: string;
}

const usable = (host: GameHost) =>
  !host.closing &&
  isElectronWindowUsable(host.window) &&
  !host.hostView.webContents.isDestroyed() &&
  !host.groupControlsView.webContents.isDestroyed();

const requireView = (host: GameHost, id: string): GameView => {
  const view = host.views.get(id);
  if (view === undefined)
    throw new Error(`Game view does not belong to this host: ${id}`);
  return view;
};

const sameGameViewPresentation = (
  left: GameViewPresentation,
  right: GameViewPresentation,
): boolean =>
  left.active === right.active &&
  left.layout === right.layout &&
  left.tiled === right.tiled &&
  left.windowActive === right.windowActive;

const gameViewSession = (
  id: string,
  record: GameView,
  index: number,
): GameViewSession => ({
  id,
  name: record.session.name ?? gameViewFallbackName(index),
  phase: record.session.state.phase,
  ...(record.session.state.phase === "error"
    ? { error: record.session.state.error }
    : {}),
});

const gameViewPresentation = (
  host: GameHost,
  id: string,
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

const cancelResize = (host: GameHost): void => {
  if (host.resizeSettleTimer === undefined) return;
  clearTimeout(host.resizeSettleTimer);
  delete host.resizeSettleTimer;
};

const setShortcutModifierPressed = (host: GameHost, pressed: boolean): void => {
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

export const makeDesktopGameHosts = Effect.fn("makeDesktopGameHosts")(
  function* (
    resources: DesktopWindowResources,
    sessions: DesktopWindowSessions,
    options: {
      readonly platform: NodeJS.Platform;
      readonly onStateChanged: (host: {
        readonly window: ElectronNativeWindowHandle;
        readonly username: string | undefined;
      }) => void;
      readonly onClosed: () => void;
    },
  ) {
    const parentScope = yield* Effect.scope;
    const run = yield* FiberSet.makeRuntime<never, void>();
    const platform = options.platform;
    const hosts = new Map<number, GameHost>();
    const byRenderer = new Map<number, GameHost>();
    const onStateChanged = (host: GameHost) =>
      options.onStateChanged({
        window: host.window,
        username: host.views.get(host.selectedId)?.session.username,
      });
    const find = (rendererId: number) => {
      const host = byRenderer.get(rendererId);
      return host !== undefined && usable(host) ? host : undefined;
    };
    const state = (host: GameHost): GameViewHostState => ({
      capacity: MAX_GAME_VIEWS_PER_WINDOW,
      groupControlsOpen: host.groupControlsOpen,
      groupTargetIds: host.orderedIds.filter((id) =>
        host.groupTargetIds.has(id),
      ),
      layout: host.layout,
      selectedId: host.selectedId,
      sessions: host.orderedIds.flatMap((id, index) => {
        const record = host.views.get(id);
        return record === undefined ? [] : [gameViewSession(id, record, index)];
      }),
    });

    const applyGroupControlsLayout = (
      host: GameHost,
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
      host: GameHost,
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

    const applyLayout = (host: GameHost): void => {
      if (!isElectronWindowUsable(host.window)) return;

      const { height, width } = host.window.getContentBounds();
      const topInset = scaledGameViewTabBarHeight(
        host.hostView.webContents.getZoomFactor(),
      );
      if (host.layout === "focused") {
        const selected = host.views.get(host.selectedId);
        if (selected !== undefined) {
          selected.boundsLayout = "focused";
          if (host.stackedGameViewId !== host.selectedId) {
            host.window.contentView.addChildView(selected.gameView.native);
            host.stackedGameViewId = host.selectedId;
          }
        }
      } else {
        for (const id of host.orderedIds) {
          const record = host.views.get(id);
          if (record !== undefined) record.boundsLayout = "grid";
        }
      }

      // Inactive views keep their last size behind the selected view, and a
      // hidden tile keeps its bounds until the grid shows it. A resized view
      // redraws everything at its new size, and views resized together compete
      // for the GPU.
      const focusedBounds = focusedGameViewBounds(width, height, topInset);
      for (const [index, id] of host.orderedIds.entries()) {
        const record = host.views.get(id);
        if (record === undefined) continue;
        if (host.layout === "focused" && record.boundsLayout === "grid")
          continue;
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

    const finishResize = (host: GameHost): void => {
      cancelResize(host);
      if (host.closing) return;

      try {
        applyLayout(host);
      } catch {}
    };

    const scheduleResize = (host: GameHost): void => {
      if (host.closing) return;

      if (host.resizeSettleTimer !== undefined) {
        clearTimeout(host.resizeSettleTimer);
      }
      // Some window managers omit Electron's `resized` event.
      host.resizeSettleTimer = setTimeout(
        () => finishResize(host),
        GAME_VIEW_RESIZE_SETTLE_DELAY_MS,
      );
    };

    const presentation = (host: GameHost, id: string): GameViewPresentation =>
      gameViewPresentation(
        host,
        id,
        host.views.get(id)?.boundsLayout ?? host.layout,
      );

    const publishPresentations = (host: GameHost): void => {
      for (const id of host.orderedIds) {
        const record = host.views.get(id);
        if (record === undefined || record.gameView.webContents.isDestroyed()) {
          continue;
        }
        const nextPresentation = presentation(host, id);
        if (
          record.publishedPresentation !== undefined &&
          sameGameViewPresentation(
            record.publishedPresentation,
            nextPresentation,
          )
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

    const publishState = (host: GameHost): void => {
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
      onStateChanged(host);
    };

    const refresh = (host: GameHost): void => {
      cancelResize(host);
      applyLayout(host);
      publishState(host);
    };

    const activate = (host: GameHost, id: string): void => {
      if (host.selectedId === id) return;
      host.selectedId = id;
      publishState(host);
    };

    const setTabMenuOpen = (host: GameHost, open: boolean): void => {
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

    const setGroupControlsOpen = (host: GameHost, open: boolean): void => {
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

      const selected = host.views.get(host.selectedId);
      if (
        !open &&
        selected !== undefined &&
        !selected.gameView.webContents.isDestroyed()
      ) {
        selected.gameView.webContents.focus();
      }
    };

    const select = (
      host: GameHost,
      id: string,
      focus: GameViewSelectionFocus,
    ): void => {
      const record = host.views.get(id);
      if (record === undefined || !host.views.has(id)) {
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

    const focus = (host: GameHost, id: string): void =>
      select(host, id, "view");

    const makeShortcutInputListener =
      (host: GameHost): ((event: ElectronEvent, input: Input) => void) =>
      (event, input) => {
        const modifierHintUpdate = readGameViewShortcutModifierHintUpdate(
          input,
          platform,
        );
        if (modifierHintUpdate !== null) {
          setShortcutModifierPressed(host, modifierHintUpdate);
        }

        const index = readGameViewShortcutIndex(
          input,
          platform,
          host.orderedIds.length,
        );
        if (index === null) return;
        const id = host.orderedIds[index];
        if (id === undefined) return;

        event.preventDefault();
        try {
          focus(host, id);
        } catch (cause) {
          run(Effect.logWarning("Failed to use game view shortcut", cause));
        }
      };

    const remove = (host: GameHost, session: DesktopWindowSession): void => {
      const index = host.orderedIds.indexOf(session.id);
      if (index < 0) return;
      host.views.delete(session.id);
      byRenderer.delete(session.rendererId);
      host.orderedIds.splice(index, 1);
      host.groupTargetIds.delete(session.id);
      if (host.stackedGameViewId === session.id) delete host.stackedGameViewId;
      if (host.closing) return;
      if (host.orderedIds.length === 0) {
        run(
          Scope.close(host.scope, Exit.void).pipe(
            Effect.tapCause((cause) =>
              Effect.logWarning("Failed to clean up game window", cause),
            ),
            Effect.uninterruptible,
          ),
        );
        return;
      }
      if (host.orderedIds.length === 1) host.layout = "focused";
      if (host.selectedId === session.id)
        host.selectedId =
          host.orderedIds[Math.min(index, host.orderedIds.length - 1)]!;
      if (usable(host)) refresh(host);
    };

    const add = Effect.fn("DesktopGameHosts.add")(function* (
      host: GameHost,
      id: string,
      input: WindowBootstrap,
      openOptions?: DesktopWindowOpenOptions,
    ) {
      if (!usable(host) || host.orderedIds.length >= MAX_GAME_VIEWS_PER_WINDOW)
        return yield* Effect.fail(
          new DesktopWindowError({
            id,
            detail: "The game window cannot accept another view.",
          }),
        );
      const layout = openOptions?.gameViewLayout ?? "focused";
      const session = yield* sessions.open({
        id,
        kind: "game",
        parentScope: host.scope,
        ...(openOptions?.gameViewName === undefined
          ? {}
          : { name: openOptions.gameViewName }),
        acquire: Effect.gen(function* () {
          const gameView = yield* resources.gameView(input, openOptions);
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              host.window.contentView.addChildView(gameView.native),
            ),
            () =>
              Effect.sync(() => {
                if (isElectronWindowUsable(host.window))
                  host.window.contentView.removeChildView(gameView.native);
              }),
          );
          return {
            gameView,
            window: host.window,
            contents: gameView.webContents,
          };
        }),
        setup: (session) =>
          Effect.gen(function* () {
            if (
              !usable(host) ||
              host.orderedIds.length >= MAX_GAME_VIEWS_PER_WINDOW
            )
              return yield* Effect.fail(
                new DesktopWindowError({
                  id,
                  detail: "The game window cannot accept another view.",
                }),
              );
            const allTargeted =
              host.groupTargetIds.size === host.orderedIds.length;
            host.views.set(id, {
              session,
              gameView: session.gameView,
              boundsLayout: layout,
            });
            host.orderedIds.push(id);
            if (allTargeted) host.groupTargetIds.add(id);
            host.selectedId = id;
            host.layout = layout;
            byRenderer.set(session.rendererId, host);
            yield* observeElectronEvent(
              session.contents,
              "before-input-event",
              makeShortcutInputListener(host),
            ).pipe(Scope.provide(session.rendererScope));
            yield* observeElectronEvent(session.contents, "focus", () => {
              if (!usable(host)) return;
              activate(host, id);
              if (host.groupControlsOpen && !host.groupControlsNativeDialogOpen)
                setGroupControlsOpen(host, false);
            }).pipe(Scope.provide(session.rendererScope));
            return undefined;
          }),
        onChanged: () => {
          if (usable(host)) publishState(host);
        },
        onClosed: (session) => remove(host, session),
        ...(openOptions?.onCreated === undefined
          ? {}
          : { onCreated: openOptions.onCreated }),
      });
      return yield* Effect.gen(function* () {
        refresh(host);
        yield* resources.loadView(session.gameView, "game").pipe(
          Effect.catch((cause) =>
            Effect.sync(() => session.loadFailed(cause.message)),
          ),
          Effect.forkIn(session.rendererScope, { startImmediately: true }),
        );
        return session;
      }).pipe(Effect.onError(() => session.close));
    });

    const create = Effect.fn("DesktopGameHosts.create")(function* (
      id: string,
      input: WindowBootstrap,
      openOptions?: DesktopWindowOpenOptions,
    ) {
      const scope = yield* Scope.fork(parentScope);
      return yield* Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(options.onClosed));
        const window = yield* resources.host(input);
        const groupControlsView = yield* resources.hostView(
          "game-group-controls",
          input,
        );
        const hostView = yield* resources.hostView("game-host", input);
        window.contentView.addChildView(hostView.native);
        const host: GameHost = {
          scope,
          get closing() {
            return scope.state._tag === "Closed";
          },
          window,
          groupControlsView,
          hostView,
          rendererId: hostView.webContents.id,
          views: new Map(),
          orderedIds: [],
          groupTargetIds: new Set(),
          selectedId: id,
          layout: "focused",
          groupControlsNativeDialogOpen: false,
          groupControlsOpen: false,
          tabMenuOpen: false,
          shortcutModifierPressed: false,
        };
        hosts.set(host.rendererId, host);
        byRenderer.set(host.rendererId, host);
        byRenderer.set(groupControlsView.webContents.id, host);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            hosts.delete(host.rendererId);
            byRenderer.delete(host.rendererId);
            byRenderer.delete(groupControlsView.webContents.id);
            cancelResize(host);
          }),
        );
        const close = () => {
          run(
            Scope.close(scope, Exit.void).pipe(
              Effect.tapCause((cause) =>
                Effect.logWarning("Failed to clean up game window", cause),
              ),
              Effect.uninterruptible,
            ),
          );
        };
        yield* observeElectronEvent(window, "closed", close);
        const hostRendererScope = yield* forkWebContentsScope(
          hostView.webContents,
        );
        yield* observeElectronEvent(
          hostView.webContents,
          "before-input-event",
          makeShortcutInputListener(host),
        ).pipe(Scope.provide(hostRendererScope));
        yield* observeElectronEvent(
          hostView.webContents,
          "did-start-loading",
          () => {
            try {
              setTabMenuOpen(host, false);
            } catch {}
          },
        ).pipe(Scope.provide(hostRendererScope));
        yield* observeElectronEvent(window, "resize", () => {
          if (!usable(host)) return;
          try {
            setTabMenuOpen(host, false);
          } catch {}
          scheduleResize(host);
        });
        yield* observeElectronEvent(window, "resized", () => {
          if (usable(host)) finishResize(host);
        });
        yield* observeElectronEvent(window, "focus", (_event: ElectronEvent) =>
          publishPresentations(host),
        );
        yield* observeElectronEvent(window, "blur", (_event: ElectronEvent) => {
          if (!usable(host)) return;
          publishPresentations(host);
          setShortcutModifierPressed(host, false);
          if (host.groupControlsOpen && !host.groupControlsNativeDialogOpen) {
            try {
              setGroupControlsOpen(host, false);
            } catch {}
          }
          try {
            setTabMenuOpen(host, false);
          } catch {}
        });
        const session = yield* add(host, id, input, openOptions);
        yield* Effect.all(
          [
            resources.loadView(groupControlsView, "game-group-controls"),
            resources.loadView(hostView, "game-host"),
          ],
          { concurrency: "unbounded" },
        );
        yield* resources.reveal(window);
        if (!session.contents.isDestroyed()) session.contents.focus();
        return session;
      }).pipe(
        Scope.provide(scope),
        Effect.forkIn(scope, { startImmediately: true }),
        Effect.flatMap((fiber) => awaitWindowCreation(id, fiber)),
        Effect.onError((cause) =>
          Scope.close(scope, Exit.failCause(cause)).pipe(
            Effect.uninterruptible,
          ),
        ),
      );
    });

    const requireHost = (rendererId: number): GameHost => {
      const host = find(rendererId);
      if (host === undefined)
        throw new Error(`Game view host is not open: ${rendererId}`);
      return host;
    };
    return {
      create,
      add: (
        rendererId: number,
        id: string,
        input: WindowBootstrap,
        openOptions?: DesktopWindowOpenOptions,
      ) =>
        Effect.suspend(() =>
          add(requireHost(rendererId), id, input, openOptions),
        ),
      available: () =>
        [...hosts.values()].find(
          (host) =>
            usable(host) && host.orderedIds.length < MAX_GAME_VIEWS_PER_WINDOW,
        )?.rendererId,
      ownsRenderer: (rendererId: number) => byRenderer.has(rendererId),
      hostId: (rendererId: number) => find(rendererId)?.rendererId,
      nativeWindow: (rendererId: number) => find(rendererId)?.window,
      rendererKind: (rendererId: number) => {
        const host = find(rendererId);
        return host?.rendererId === rendererId
          ? ("game-host" as const)
          : host?.groupControlsView.webContents.id === rendererId
            ? ("game-group-controls" as const)
            : undefined;
      },
      state: (rendererId: number) => state(requireHost(rendererId)),
      closeView: (rendererId: number, id: string) =>
        Effect.suspend(
          () => requireView(requireHost(rendererId), id).session.close,
        ),
      reveal: (rendererId: number) => {
        const host = requireHost(rendererId);
        const view = [...host.views.values()].find(
          (view) => view.session.rendererId === rendererId,
        );
        if (view !== undefined) focus(host, view.session.id);
      },
      select: (
        rendererId: number,
        id: string,
        focus: GameViewSelectionFocus,
      ) => {
        const host = requireHost(rendererId);
        requireView(host, id);
        select(host, id, focus);
        return state(host);
      },
      reorder: (rendererId: number, ids: readonly string[]) => {
        const host = requireHost(rendererId);
        if (
          ids.length !== host.views.size ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !host.views.has(id))
        )
          throw new Error(
            "Tab order must include each game view exactly once.",
          );
        if (ids.every((id, index) => host.orderedIds[index] === id))
          return state(host);
        host.orderedIds.splice(0, host.orderedIds.length, ...ids);
        refresh(host);
        return state(host);
      },
      setLayout: (rendererId: number, layout: GameViewLayout) => {
        const host = requireHost(rendererId);
        if (host.layout !== layout) {
          host.layout = layout;
          refresh(host);
        }
        return state(host);
      },
      setGroupControlsOpen: (rendererId: number, open: boolean) => {
        const host = requireHost(rendererId);
        setGroupControlsOpen(host, open);
        return state(host);
      },
      nativeDialog: (rendererId: number) => {
        const host = requireHost(rendererId);
        host.groupControlsNativeDialogOpen = true;
        return {
          windowId: host.window.id,
          restore: () => {
            host.groupControlsNativeDialogOpen = false;
            if (host.groupControlsOpen && usable(host)) {
              host.window.contentView.addChildView(
                host.groupControlsView.native,
              );
              host.groupControlsView.webContents.focus();
            }
          },
        };
      },
      setGroupTargets: (rendererId: number, ids: readonly string[]) => {
        const host = requireHost(rendererId);
        const unique = new Set(ids);
        if (unique.size !== ids.length || ids.some((id) => !host.views.has(id)))
          throw new Error(
            "Group targets must be unique tabs in this game window.",
          );
        if (
          unique.size !== host.groupTargetIds.size ||
          ids.some((id) => !host.groupTargetIds.has(id))
        ) {
          host.groupTargetIds.clear();
          for (const id of ids) host.groupTargetIds.add(id);
          publishState(host);
        }
        return state(host);
      },
      presentation: (rendererId: number) => {
        const host = requireHost(rendererId);
        const view = [...host.views.values()].find(
          (view) => view.session.rendererId === rendererId,
        );
        if (view === undefined)
          throw new Error(`Game view is not open: ${rendererId}`);
        return presentation(host, view.session.id);
      },
      setTabMenuOpen: (rendererId: number, open: boolean) => {
        const host = requireHost(rendererId);
        if (open && host.groupControlsOpen) setGroupControlsOpen(host, false);
        setTabMenuOpen(host, open);
        return host.tabMenuOpen;
      },
      syncTabBarLayout: (rendererId: number) =>
        applyLayout(requireHost(rendererId)),
      refreshTitles: () => {
        for (const host of hosts.values()) onStateChanged(host);
      },
      setViewBackgroundColor: (
        session: DesktopWindowSession,
        color: string,
      ) => {
        const view = byRenderer
          .get(session.rendererId)
          ?.views.get(session.id)?.gameView;
        if (view !== undefined && !view.webContents.isDestroyed())
          view.setBackgroundColor(color);
      },
      reloadFocused: (
        windowId: number,
        rendererId: number,
        bypassCache: boolean,
      ) => {
        const host = [...hosts.values()].find(
          (host) => host.window.id === windowId && usable(host),
        );
        if (host === undefined || host.layout !== "focused") return false;
        const selected = host.views.get(host.selectedId);
        if (
          selected === undefined ||
          (rendererId !== host.rendererId &&
            rendererId !== selected.session.rendererId)
        )
          return false;
        for (const contents of [
          host.hostView.webContents,
          selected.gameView.webContents,
        ]) {
          if (bypassCache) contents.reloadIgnoringCache();
          else contents.reload();
        }
        return true;
      },
    };
  },
);
