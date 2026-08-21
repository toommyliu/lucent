import {
  Icon,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipIconButton,
  TooltipTrigger,
  VisuallyHidden,
  type IconButtonProps,
} from "@lucent/ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import type {
  GameViewHostState,
  GameViewSession,
  GameViewSelectionFocus,
} from "../../../shared/gameViews";
import { selectDesktopBridge } from "../../../shared/desktopBridge";
import {
  gameViewTabNavigationTargetId,
  reorderedGameViewIds,
  type GameViewDropEdge,
  type GameViewTabNavigationKey,
} from "./tabOrder";

const SHORTCUT_HINT_DELAY_MS = 300;
const TAB_TOOLTIP_KEYBOARD_SETTLE_MS = 500;
const actionTooltipPositioning = {
  fitViewport: true,
  overflowPadding: 4,
  placement: "left",
} as const;
const tabTooltipPositioning = {
  fitViewport: true,
  overflowPadding: 4,
  placement: "right",
} as const;

const gameViewHost = selectDesktopBridge(
  window.desktop,
  "game-host",
).gameViewHost;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Game view request failed.";

const sameSession = (
  previous: GameViewSession,
  next: GameViewSession,
): boolean =>
  previous.id === next.id &&
  previous.name === next.name &&
  previous.phase === next.phase &&
  previous.error === next.error;

/** Preserves tab DOM identity when host updates only presentation state. */
const reconcileSessions = (
  previous: readonly GameViewSession[],
  next: readonly GameViewSession[],
): readonly GameViewSession[] => {
  const previousById = new Map(
    previous.map((session) => [session.id, session] as const),
  );
  let changed = previous.length !== next.length;
  const sessions = next.map((session, index) => {
    const previousSession = previousById.get(session.id);
    if (
      previousSession !== undefined &&
      sameSession(previousSession, session)
    ) {
      changed ||= previous[index] !== previousSession;
      return previousSession;
    }

    changed = true;
    return session;
  });
  return changed ? sessions : previous;
};

const sameHostState = (
  previous: GameViewHostState | null,
  next: GameViewHostState,
): boolean =>
  previous !== null &&
  previous.capacity === next.capacity &&
  previous.groupControlsOpen === next.groupControlsOpen &&
  previous.groupTargetIds.length === next.groupTargetIds.length &&
  previous.groupTargetIds.every(
    (id, index) => next.groupTargetIds[index] === id,
  ) &&
  previous.layout === next.layout &&
  previous.selectedId === next.selectedId &&
  previous.sessions.length === next.sessions.length &&
  previous.sessions.every((session, index) => {
    const nextSession = next.sessions[index];
    return nextSession !== undefined && sameSession(session, nextSession);
  });

const findTab = (id: string): HTMLButtonElement | null => {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(
    "[data-game-view-tab-id]",
  )) {
    if (tab.dataset["gameViewTabId"] === id) {
      return tab;
    }
  }
  return null;
};

const focusTab = (id: string): void => {
  const tab = findTab(id);
  if (tab === null) return;
  tab.focus({ preventScroll: true });
};

export function App(): JSX.Element {
  const [state, setState] = createSignal<GameViewHostState | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [closingId, setClosingId] = createSignal<string | null>(null);
  const [draggedIds, setDraggedIds] = createSignal<readonly string[]>([]);
  const [openTabTooltipId, setOpenTabTooltipId] = createSignal<string | null>(
    null,
  );
  const [dragOrder, setDragOrder] = createSignal<readonly string[] | null>(
    null,
  );
  const [requestError, setRequestError] = createSignal<string | null>(null);
  const [shortcutHintsVisible, setShortcutHintsVisible] = createSignal(false);
  const [tabMenuOpen, setTabMenuOpen] = createSignal(false);
  const [tabTooltipsKeyboardSuppressed, setTabTooltipsKeyboardSuppressed] =
    createSignal(false);
  const [visibleTabCount, setVisibleTabCount] = createSignal(1);
  const [suppressedSelectId, setSuppressedSelectId] = createSignal<
    string | null
  >(null);
  let desiredGroupTargetIds: readonly string[] | null = null;
  let desiredTabMenuOpen: boolean | null = null;
  let groupTargetRequestRunning = false;
  let tabMenuRequestRunning = false;
  let stopPointerDrag: (() => void) | undefined;
  let selectSuppressionTimer: number | undefined;
  let shortcutHintTimer: number | undefined;
  let tabTooltipKeyboardTimer: number | undefined;
  let tabTooltipOpenFrame: number | undefined;
  let tabList: HTMLDivElement | undefined;
  let tabStrip: HTMLDivElement | undefined;
  let tabLayoutVersion = 0;

  const applyState = (nextState: GameViewHostState): void => {
    const visibleState =
      desiredGroupTargetIds === null
        ? nextState
        : { ...nextState, groupTargetIds: desiredGroupTargetIds };
    setState((previous) => {
      const reconciledState =
        previous === null
          ? visibleState
          : {
              ...visibleState,
              sessions: reconcileSessions(
                previous.sessions,
                visibleState.sessions,
              ),
            };
      return sameHostState(previous, reconciledState)
        ? previous
        : reconciledState;
    });
  };

  const atCapacity = createMemo(() => {
    const current = state();
    return current !== null && current.sessions.length >= current.capacity;
  });
  const displayedSessions = createMemo(() => {
    const current = state();
    const order = dragOrder();
    if (current === null || order === null) {
      return current?.sessions ?? [];
    }

    const sessionsById = new Map(
      current.sessions.map((session) => [session.id, session] as const),
    );
    const sessions = order.flatMap((id) => {
      const session = sessionsById.get(id);
      return session === undefined ? [] : [session];
    });
    return sessions.length === current.sessions.length
      ? sessions
      : current.sessions;
  });
  const visibleSessions = createMemo(() => {
    const sessions = displayedSessions();
    const count = Math.min(visibleTabCount(), sessions.length);
    if (count >= sessions.length) return sessions;

    const selectedId = state()?.selectedId;
    const selectedIndex = sessions.findIndex(
      (session) => session.id === selectedId,
    );
    if (selectedIndex < count) return sessions.slice(0, count);
    const selected = sessions[selectedIndex];
    if (selected === undefined) return sessions.slice(0, count);
    return count === 1
      ? [selected]
      : [...sessions.slice(0, count - 1), selected];
  });
  const overflowSessions = createMemo(() => {
    const visibleIds = new Set(visibleSessions().map((session) => session.id));
    return displayedSessions().filter((session) => !visibleIds.has(session.id));
  });

  /** Shrinks tabs to their CSS minimum, then moves excess tabs into the menu. */
  const fitTabs = (): void => {
    const version = ++tabLayoutVersion;
    setVisibleTabCount(Math.max(1, displayedSessions().length));

    const measure = (): void => {
      queueMicrotask(() => {
        if (version !== tabLayoutVersion || tabList === undefined) return;
        if (
          tabList.scrollWidth > tabList.clientWidth + 1 &&
          visibleTabCount() > 1
        ) {
          setVisibleTabCount((count) => count - 1);
          measure();
        }
      });
    };
    measure();
  };

  createEffect(() => {
    state();
    queueMicrotask(fitTabs);
  });

  const runStateRequest = async (
    request: () => Promise<GameViewHostState>,
  ): Promise<GameViewHostState | null> => {
    setRequestError(null);
    try {
      const nextState = await request();
      applyState(nextState);
      return nextState;
    } catch (cause) {
      setRequestError(errorMessage(cause));
      return null;
    }
  };

  const addView = async (): Promise<void> => {
    if (adding() || atCapacity()) return;
    setAdding(true);
    const nextState = await runStateRequest(() => gameViewHost.add());
    setAdding(false);
    if (nextState === null) return;
  };

  const closeView = async (id: string): Promise<void> => {
    if (closingId() !== null) return;
    const current = state();
    const closedIndex =
      current?.sessions.findIndex((session) => session.id === id) ?? -1;
    const nextFocusId =
      current === null || closedIndex < 0 || current.sessions.length < 2
        ? null
        : id === current.selectedId
          ? current.sessions[Math.min(closedIndex, current.sessions.length - 2)]
              ?.id
          : current.selectedId;
    setRequestError(null);
    setClosingId(id);
    try {
      await gameViewHost.close(id);
      if (nextFocusId !== null && nextFocusId !== undefined) {
        window.requestAnimationFrame(() => focusTab(nextFocusId));
      }
    } catch (cause) {
      setRequestError(errorMessage(cause));
    } finally {
      setClosingId(null);
    }
  };

  const selectView = (
    id: string,
    focus: GameViewSelectionFocus = "view",
  ): void => {
    const current = state();
    if (
      current === null ||
      (current.layout === "focused" && current.selectedId === id)
    ) {
      if (focus === "host") focusTab(id);
      return;
    }
    if (focus === "host") focusTab(id);
    void runStateRequest(() => gameViewHost.select(id, focus)).then(
      (nextState) => {
        if (focus === "host" && nextState !== null) {
          window.requestAnimationFrame(() => focusTab(id));
        }
      },
    );
  };

  const flushTabMenuOpen = async (): Promise<void> => {
    if (tabMenuRequestRunning) return;
    tabMenuRequestRunning = true;
    try {
      while (desiredTabMenuOpen !== null) {
        const requestedOpen = desiredTabMenuOpen;
        try {
          const open = await gameViewHost.setTabMenuOpen(requestedOpen);
          if (desiredTabMenuOpen === requestedOpen) {
            desiredTabMenuOpen = null;
            setTabMenuOpen(open);
          }
        } catch (cause) {
          setRequestError(errorMessage(cause));
          if (desiredTabMenuOpen !== requestedOpen) continue;

          desiredTabMenuOpen = null;
          setTabMenuOpen(!requestedOpen);
        }
      }
    } finally {
      tabMenuRequestRunning = false;
    }
  };

  const requestTabMenuOpen = (open: boolean): void => {
    if (
      desiredTabMenuOpen === open ||
      (tabMenuOpen() === open && desiredTabMenuOpen === null)
    ) {
      return;
    }
    setRequestError(null);
    if (!open) setTabMenuOpen(false);
    desiredTabMenuOpen = open;
    void flushTabMenuOpen();
  };

  createEffect(() => {
    if (overflowSessions().length === 0 && tabMenuOpen()) {
      requestTabMenuOpen(false);
    }
  });

  const selectOverflowView = (id: string): void => {
    void runStateRequest(() => gameViewHost.select(id, "view"));
  };

  /** Coalesces rapid toggles while keeping target feedback immediate. */
  const flushGroupTargets = async (): Promise<void> => {
    if (groupTargetRequestRunning) return;
    groupTargetRequestRunning = true;
    try {
      while (desiredGroupTargetIds !== null) {
        const requestedIds = desiredGroupTargetIds;
        try {
          const nextState = await gameViewHost.setGroupTargets(requestedIds);
          if (desiredGroupTargetIds === requestedIds) {
            desiredGroupTargetIds = null;
          }
          applyState(nextState);
        } catch (cause) {
          setRequestError(errorMessage(cause));
          if (desiredGroupTargetIds !== requestedIds) continue;

          desiredGroupTargetIds = null;
          try {
            applyState(await gameViewHost.getState());
          } catch {}
        }
      }
    } finally {
      groupTargetRequestRunning = false;
    }
  };

  const setGroupTarget = (id: string, selected: boolean): void => {
    const current = state();
    if (current === null || current.groupTargetIds.includes(id) === selected) {
      return;
    }
    const ids = current.sessions
      .map((session) => session.id)
      .filter((sessionId) =>
        sessionId === id
          ? selected
          : current.groupTargetIds.includes(sessionId),
      );
    desiredGroupTargetIds = ids;
    applyState({ ...current, groupTargetIds: ids });
    setRequestError(null);
    void flushGroupTargets();
  };

  const toggleGroupTarget = (id: string): void => {
    const current = state();
    if (current === null) return;
    setGroupTarget(id, !current.groupTargetIds.includes(id));
  };

  const handleTabClick = (event: MouseEvent, id: string): void => {
    if (suppressedSelectId() === id) {
      setSuppressedSelectId(null);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      toggleGroupTarget(id);
      return;
    }
    selectView(id);
  };

  const commitOrder = (ids: readonly string[]): void => {
    const current = state();
    if (
      current === null ||
      ids.every((id, index) => current.sessions[index]?.id === id)
    ) {
      setDragOrder(null);
      return;
    }
    setDragOrder(ids);
    void runStateRequest(() => gameViewHost.reorder(ids)).finally(() => {
      setDragOrder(null);
    });
  };

  const moveView = (id: string, offset: -1 | 1): void => {
    const current = state();
    if (current === null) return;
    const ids = current.sessions.map((session) => session.id);
    const index = ids.indexOf(id);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex]!, ids[index]!];
    commitOrder(ids);
  };

  const allowTabTooltips = (): void => {
    if (tabTooltipKeyboardTimer !== undefined) {
      window.clearTimeout(tabTooltipKeyboardTimer);
      tabTooltipKeyboardTimer = undefined;
    }
    if (tabTooltipOpenFrame !== undefined) {
      window.cancelAnimationFrame(tabTooltipOpenFrame);
      tabTooltipOpenFrame = undefined;
    }
    setTabTooltipsKeyboardSuppressed(false);
  };

  /** Shows one tooltip after keyboard focus settles instead of one per hop. */
  const suppressTabTooltipsForKeyboardNavigation = (): void => {
    if (tabTooltipKeyboardTimer !== undefined) {
      window.clearTimeout(tabTooltipKeyboardTimer);
    }
    if (tabTooltipOpenFrame !== undefined) {
      window.cancelAnimationFrame(tabTooltipOpenFrame);
      tabTooltipOpenFrame = undefined;
    }
    setOpenTabTooltipId(null);
    setTabTooltipsKeyboardSuppressed(true);
    tabTooltipKeyboardTimer = window.setTimeout(() => {
      tabTooltipKeyboardTimer = undefined;
      setTabTooltipsKeyboardSuppressed(false);
      tabTooltipOpenFrame = window.requestAnimationFrame(() => {
        tabTooltipOpenFrame = undefined;
        const focusedTab =
          document.activeElement instanceof HTMLElement
            ? document.activeElement.dataset["gameViewTabId"]
            : undefined;
        setOpenTabTooltipId(focusedTab ?? null);
      });
    }, TAB_TOOLTIP_KEYBOARD_SETTLE_MS);
  };

  const handleTabKeyDown = (event: KeyboardEvent, id: string): void => {
    if (event.altKey && event.shiftKey) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveView(id, -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveView(id, 1);
      }
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      toggleGroupTarget(id);
      return;
    }
    if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    suppressTabTooltipsForKeyboardNavigation();
    const targetId = gameViewTabNavigationTargetId(
      displayedSessions().map((session) => session.id),
      id,
      event.key satisfies GameViewTabNavigationKey,
    );
    if (targetId === null) return;
    event.preventDefault();
    selectView(targetId, "host");
  };

  /** Keeps each visible close button next to its tab in the focus order. */
  const handleTabBarKeyDown = (
    event: KeyboardEvent & { readonly currentTarget: HTMLElement },
  ): void => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (!(event.target instanceof HTMLButtonElement)) return;

    const tabControls = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".game-view-tab__select, .game-view-tab__close:not(:disabled)",
      ),
    );
    const actions = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".game-view-tabs__action:not(:disabled)",
      ),
    );
    const controls = [...tabControls, ...actions];
    const currentIndex = controls.indexOf(event.target);
    if (currentIndex < 0 || controls.length === 0) return;

    suppressTabTooltipsForKeyboardNavigation();
    const offset = event.shiftKey ? -1 : 1;
    const next =
      controls[(currentIndex + offset + controls.length) % controls.length];
    if (next === undefined) return;

    event.preventDefault();
    next.focus({ preventScroll: true });
  };

  const beginPointerDrag = (
    event: PointerEvent & { readonly currentTarget: HTMLDivElement },
    id: string,
  ): void => {
    if (!event.isPrimary || event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(".game-view-tab__close") !== null
    ) {
      return;
    }

    const initialIds = displayedSessions().map((session) => session.id);
    if (initialIds.length < 2) return;
    const groupTargetIds = new Set(state()?.groupTargetIds ?? []);
    const selectedMovingIds = groupTargetIds.has(id)
      ? initialIds.filter((sessionId) => groupTargetIds.has(sessionId))
      : [];
    // Moving every tab cannot change the order, so preserve single-tab dragging.
    const movingIds =
      selectedMovingIds.length > 0 &&
      selectedMovingIds.length < initialIds.length
        ? selectedMovingIds
        : [id];
    const movingIdSet = new Set(movingIds);

    stopPointerDrag?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const tab = event.currentTarget;
    let active = false;

    const removeListeners = (): void => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      stopPointerDrag = undefined;
    };

    const resetDrag = (): void => {
      setDraggedIds([]);
    };

    const scheduleSelectSuppressionClear = (): void => {
      if (selectSuppressionTimer !== undefined) {
        window.clearTimeout(selectSuppressionTimer);
      }
      selectSuppressionTimer = window.setTimeout(() => {
        setSuppressedSelectId((current) => (current === id ? null : current));
        selectSuppressionTimer = undefined;
      });
    };

    const suppressSelect = (deferClear = false): void => {
      setSuppressedSelectId(id);
      if (selectSuppressionTimer !== undefined) {
        window.clearTimeout(selectSuppressionTimer);
        selectSuppressionTimer = undefined;
      }
      if (!deferClear) {
        scheduleSelectSuppressionClear();
      }
    };

    const finish = (commit: boolean, deferSelectClear = false): void => {
      const order = dragOrder();
      removeListeners();
      resetDrag();
      if (!active) {
        setDragOrder(null);
        return;
      }

      suppressSelect(deferSelectClear);
      if (commit && order !== null) {
        commitOrder(order);
      } else {
        setDragOrder(null);
      }
    };

    const clearSelectSuppressionAfterPointerRelease = (): void => {
      const removeReleaseListeners = (): void => {
        window.removeEventListener("pointerup", handlePointerRelease);
        window.removeEventListener("pointercancel", handlePointerRelease);
        stopPointerDrag = undefined;
      };
      const cancelReleaseWait = (): void => {
        removeReleaseListeners();
        setSuppressedSelectId((current) => (current === id ? null : current));
      };

      function handlePointerRelease(nextEvent: PointerEvent): void {
        if (nextEvent.pointerId !== pointerId) return;
        removeReleaseListeners();
        // A click may follow pointerup synchronously; clear on the next task.
        scheduleSelectSuppressionClear();
      }

      stopPointerDrag = cancelReleaseWait;
      window.addEventListener("pointerup", handlePointerRelease);
      window.addEventListener("pointercancel", handlePointerRelease);
    };

    function handlePointerMove(nextEvent: PointerEvent): void {
      if (nextEvent.pointerId !== pointerId) return;
      if (
        !active &&
        Math.hypot(nextEvent.clientX - startX, nextEvent.clientY - startY) < 4
      ) {
        return;
      }

      if (!active) {
        active = true;
        tab
          .querySelector<HTMLButtonElement>(".game-view-tab__select")
          ?.focus({ preventScroll: true });
        setOpenTabTooltipId(null);
        setDraggedIds(movingIds);
        setDragOrder(initialIds);
      }
      nextEvent.preventDefault();

      const tabs = Array.from(
        document.querySelectorAll<HTMLElement>("[data-game-view-id]"),
      ).filter((tab) => {
        const tabId = tab.dataset["gameViewId"];
        return tabId !== undefined && !movingIdSet.has(tabId);
      });
      if (tabs.length === 0) return;

      const before = tabs.find((tab) => {
        const bounds = tab.getBoundingClientRect();
        return nextEvent.clientX < bounds.left + bounds.width / 2;
      });
      const target = before ?? tabs[tabs.length - 1]!;
      const targetId = target.dataset["gameViewId"];
      if (targetId === undefined) return;
      const edge: GameViewDropEdge = before === undefined ? "after" : "before";
      setDragOrder((current) =>
        reorderedGameViewIds(current ?? initialIds, movingIds, targetId, edge),
      );
    }

    function handlePointerUp(nextEvent: PointerEvent): void {
      if (nextEvent.pointerId === pointerId) finish(true);
    }

    function handlePointerCancel(nextEvent: PointerEvent): void {
      if (nextEvent.pointerId === pointerId) finish(false);
    }

    function handleKeyDown(nextEvent: KeyboardEvent): void {
      if (!active || nextEvent.key !== "Escape") return;
      nextEvent.preventDefault();
      nextEvent.stopPropagation();
      finish(false, true);
      clearSelectSuppressionAfterPointerRelease();
    }

    stopPointerDrag = () => {
      removeListeners();
      resetDrag();
      setDragOrder(null);
    };
    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
  };

  const toggleLayout = (): void => {
    const current = state();
    if (current === null || current.sessions.length < 2) return;
    void runStateRequest(() =>
      gameViewHost.setLayout(current.layout === "grid" ? "focused" : "grid"),
    );
  };

  const toggleGroupControls = (): void => {
    const current = state();
    if (current === null) return;
    if (tabMenuOpen()) requestTabMenuOpen(false);
    const open = !current.groupControlsOpen;
    applyState({ ...current, groupControlsOpen: open });
    setRequestError(null);
    void gameViewHost
      .setGroupControlsOpen(open)
      .then(applyState)
      .catch((cause: unknown) => {
        applyState(current);
        setRequestError(errorMessage(cause));
      });
  };

  const updateShortcutModifier = (pressed: boolean): void => {
    if (!pressed) {
      if (shortcutHintTimer !== undefined) {
        window.clearTimeout(shortcutHintTimer);
        shortcutHintTimer = undefined;
      }
      setShortcutHintsVisible(false);
      return;
    }
    if (shortcutHintsVisible() || shortcutHintTimer !== undefined) {
      return;
    }

    shortcutHintTimer = window.setTimeout(() => {
      shortcutHintTimer = undefined;
      setShortcutHintsVisible(true);
    }, SHORTCUT_HINT_DELAY_MS);
  };

  onMount(() => {
    let disposed = false;
    const tabStripResizeObserver = new ResizeObserver(fitTabs);
    if (tabStrip !== undefined) {
      tabStripResizeObserver.observe(tabStrip);
      fitTabs();
    }
    const unsubscribe = gameViewHost.onChanged((nextState) => {
      if (!disposed) applyState(nextState);
    });
    const unsubscribeShortcutModifier = gameViewHost.onShortcutModifierChanged(
      (pressed) => {
        if (!disposed) updateShortcutModifier(pressed);
      },
    );
    const unsubscribeTabMenu = gameViewHost.onTabMenuOpenChanged((open) => {
      if (disposed) return;
      setTabMenuOpen(open);
      if (desiredTabMenuOpen === open) {
        desiredTabMenuOpen = null;
      }
    });
    void gameViewHost
      .getState()
      .then((nextState) => {
        if (!disposed) applyState(nextState);
      })
      .catch((cause: unknown) => {
        if (!disposed) setRequestError(errorMessage(cause));
      });
    onCleanup(() => {
      disposed = true;
      desiredTabMenuOpen = null;
      unsubscribe();
      unsubscribeShortcutModifier();
      unsubscribeTabMenu();
      tabStripResizeObserver.disconnect();
      tabLayoutVersion += 1;
      stopPointerDrag?.();
      if (selectSuppressionTimer !== undefined) {
        window.clearTimeout(selectSuppressionTimer);
      }
      if (shortcutHintTimer !== undefined) {
        window.clearTimeout(shortcutHintTimer);
      }
      if (tabTooltipKeyboardTimer !== undefined) {
        window.clearTimeout(tabTooltipKeyboardTimer);
      }
      if (tabTooltipOpenFrame !== undefined) {
        window.cancelAnimationFrame(tabTooltipOpenFrame);
      }
    });
  });

  return (
    <main class="game-view-host">
      <header class="game-view-tabs" onKeyDown={handleTabBarKeyDown}>
        <div
          class="game-view-tabs__strip"
          ref={(element) => {
            tabStrip = element;
          }}
        >
          <div
            aria-label="Game views"
            class="game-view-tabs__list"
            ref={(element) => {
              tabList = element;
            }}
            role="tablist"
          >
            <For each={visibleSessions()}>
              {(session) => {
                const active = () => state()?.selectedId === session.id;
                const groupTargeted = () =>
                  state()?.groupTargetIds.includes(session.id) ?? false;
                const dragging = () => draggedIds().includes(session.id);
                const index = () =>
                  displayedSessions().findIndex(
                    (candidate) => candidate.id === session.id,
                  );

                return (
                  <div
                    class="game-view-tab"
                    classList={{
                      "game-view-tab--dragging": dragging(),
                      "game-view-tab--active": active(),
                      "game-view-tab--targeted": groupTargeted(),
                    }}
                    data-game-view-id={session.id}
                    onPointerDown={(event) =>
                      beginPointerDrag(event, session.id)
                    }
                    role="presentation"
                  >
                    <Tooltip
                      closeDelay={0}
                      disabled={
                        draggedIds().length > 0 ||
                        tabTooltipsKeyboardSuppressed()
                      }
                      open={
                        openTabTooltipId() === session.id &&
                        draggedIds().length === 0 &&
                        !tabTooltipsKeyboardSuppressed()
                      }
                      openDelay={200}
                      positioning={tabTooltipPositioning}
                      onOpenChange={(details) => {
                        setOpenTabTooltipId((current) => {
                          if (details.open) {
                            return draggedIds().length === 0 &&
                              !tabTooltipsKeyboardSuppressed()
                              ? session.id
                              : current;
                          }
                          return current === session.id ? null : current;
                        });
                      }}
                    >
                      <TooltipTrigger
                        asChild={(triggerProps) => (
                          <button
                            {...triggerProps({
                              "aria-grabbed": dragging() ? "true" : "false",
                              "aria-keyshortcuts": `Meta+${index() + 1} Control+${index() + 1} Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Meta+Enter Control+Enter Meta+Space Control+Space`,
                              "aria-label": `${session.name}, ${groupTargeted() ? "selected" : "not selected"} for group actions`,
                              "aria-selected": active() ? "true" : "false",
                              class: "game-view-tab__select",
                              onClick: (event: MouseEvent) =>
                                handleTabClick(event, session.id),
                              onFocus: (
                                event: FocusEvent & {
                                  readonly currentTarget: HTMLButtonElement;
                                },
                              ) => {
                                if (
                                  event.currentTarget.matches(":focus-visible")
                                ) {
                                  suppressTabTooltipsForKeyboardNavigation();
                                }
                              },
                              onKeyDown: (event: KeyboardEvent) =>
                                handleTabKeyDown(event, session.id),
                              onPointerEnter: allowTabTooltips,
                              role: "tab",
                              tabIndex: active() ? 0 : -1,
                              type: "button",
                            })}
                            data-game-view-tab-id={session.id}
                          >
                            <Show when={session.phase !== "ready"}>
                              <Show
                                when={session.phase !== "error"}
                                fallback={
                                  <Icon
                                    aria-hidden="true"
                                    class="game-view-tab__status game-view-tab__status--error"
                                    icon="circle_alert"
                                    size="xs"
                                  />
                                }
                              >
                                <Spinner
                                  class="game-view-tab__status"
                                  size="sm"
                                />
                              </Show>
                            </Show>
                            <span class="game-view-tab__label">
                              {session.name}
                            </span>
                          </button>
                        )}
                      />
                      <TooltipContent>
                        {session.phase === "error"
                          ? `${session.name}: ${session.error}`
                          : session.name}
                      </TooltipContent>
                    </Tooltip>
                    <kbd
                      aria-hidden="true"
                      class="game-view-tab__shortcut"
                      classList={{
                        "game-view-tab__shortcut--visible":
                          shortcutHintsVisible(),
                      }}
                    >
                      {index() + 1}
                    </kbd>
                    <button
                      aria-label={`Close ${session.name}`}
                      class="game-view-tab__close"
                      disabled={closingId() !== null}
                      onClick={() => void closeView(session.id)}
                      tabIndex={-1}
                      type="button"
                    >
                      <Icon aria-hidden="true" icon="x" size="xs" />
                    </button>
                  </div>
                );
              }}
            </For>
          </div>

          <Show when={overflowSessions().length > 0}>
            <Menu
              aria-label="More game views"
              open={tabMenuOpen()}
              positioning={{
                fitViewport: true,
                overflowPadding: 4,
                placement: "bottom-end",
              }}
              unmountOnExit
              onOpenChange={(details) => {
                requestTabMenuOpen(details.open);
              }}
            >
              <MenuTrigger
                asChild={(triggerProps) => (
                  <IconButton
                    {...(triggerProps({
                      "aria-label": `Show ${overflowSessions().length} more game ${overflowSessions().length === 1 ? "view" : "views"}`,
                      class: "game-view-tabs__action game-view-tabs__overflow",
                      size: "icon-sm",
                      type: "button",
                      variant: "ghost",
                    } as IconButtonProps) as IconButtonProps)}
                  >
                    <Icon aria-hidden="true" icon="ellipsis" size="sm" />
                  </IconButton>
                )}
              />
              <MenuContent class="game-view-tabs__menu-content">
                <For each={overflowSessions()}>
                  {(session) => (
                    <MenuItem
                      onSelect={() => selectOverflowView(session.id)}
                      value={session.id}
                    >
                      <Show when={session.phase !== "ready"}>
                        <Show
                          when={session.phase !== "error"}
                          fallback={
                            <Icon
                              aria-hidden="true"
                              class="game-view-tabs__menu-status game-view-tabs__menu-status--error"
                              icon="circle_alert"
                              size="xs"
                            />
                          }
                        >
                          <Spinner
                            class="game-view-tabs__menu-status"
                            size="sm"
                          />
                        </Show>
                      </Show>
                      <span
                        class="game-view-tabs__menu-item-label"
                        title={session.name}
                      >
                        {session.name}
                      </span>
                    </MenuItem>
                  )}
                </For>
              </MenuContent>
            </Menu>
          </Show>

          <TooltipIconButton
            aria-label={
              atCapacity() ? "Game view limit reached" : "Add another game view"
            }
            class="game-view-tabs__action game-view-tabs__add"
            disabled={atCapacity()}
            onClick={() => void addView()}
            pending={adding()}
            positioning={actionTooltipPositioning}
            size="icon-sm"
            tooltip={
              atCapacity()
                ? `${state()?.capacity ?? 0}-view limit reached · use another window`
                : "Add game view"
            }
            variant="ghost"
          >
            <Icon aria-hidden="true" icon="plus" size="sm" />
          </TooltipIconButton>
        </div>

        <div class="game-view-tabs__actions">
          <Show when={requestError()}>
            {(message) => (
              <span
                class="game-view-tabs__error"
                role="alert"
                title={message()}
              >
                <Icon aria-hidden="true" icon="circle_alert" size="sm" />
                <VisuallyHidden>{message()}</VisuallyHidden>
              </span>
            )}
          </Show>
          <TooltipIconButton
            aria-label={
              state()?.groupControlsOpen
                ? "Close group controls"
                : "Open group controls"
            }
            aria-pressed={state()?.groupControlsOpen ? "true" : "false"}
            class="game-view-tabs__action game-view-tabs__group-action"
            classList={{
              "game-view-tabs__group-action--active":
                state()?.groupControlsOpen,
            }}
            onClick={toggleGroupControls}
            positioning={actionTooltipPositioning}
            size="icon-sm"
            tooltip="Group controls"
            variant="ghost"
          >
            <Icon aria-hidden="true" icon="monitor_cog" size="sm" />
          </TooltipIconButton>
          <TooltipIconButton
            aria-label={
              state()?.layout === "grid"
                ? "Focus selected view"
                : "Show grid view"
            }
            aria-pressed={state()?.layout === "grid" ? "true" : "false"}
            class="game-view-tabs__action game-view-tabs__layout"
            classList={{
              "game-view-tabs__layout--active": state()?.layout === "grid",
            }}
            disabled={(state()?.sessions.length ?? 0) < 2}
            onClick={toggleLayout}
            positioning={actionTooltipPositioning}
            size="icon-sm"
            tooltip={
              state()?.layout === "grid"
                ? "Focus selected view"
                : "Show grid view"
            }
            variant="ghost"
          >
            <Icon
              aria-hidden="true"
              icon={state()?.layout === "grid" ? "maximize_2" : "grid_2x2"}
              size="sm"
            />
          </TooltipIconButton>
        </div>
      </header>
    </main>
  );
}
