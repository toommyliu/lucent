import { WindowIds, type WindowId } from "../../shared/windows";
import {
  makeAppWindowRef,
  makeGameChildWindowRef,
  makeGameWindowRef,
  type AppWindowRef,
  type CatalogWindowRef,
  type GameChildWindowRef,
  type GameWindowRef,
  type ManagedWindowRef,
} from "./WindowTypes";

export interface WindowPresence {
  readonly usable: boolean;
  readonly visible: boolean;
  readonly minimized: boolean;
}

export interface WindowModelState {
  readonly appWindows: ReadonlyMap<WindowId, AppWindowRef>;
  readonly gameWindows: ReadonlyMap<number, GameWindowRef>;
  readonly gameChildWindows: ReadonlyMap<
    number,
    ReadonlyMap<WindowId, GameChildWindowRef>
  >;
  readonly parentGameWindowIds: ReadonlyMap<number, number>;
  readonly windowContexts: ReadonlyMap<number, unknown>;
  readonly forceClosingWindowIds: ReadonlySet<number>;
  readonly inFlightOpenKeys: ReadonlySet<string>;
  readonly lastFocusedGameWindowId: number | null;
  readonly lastFocusedPrimaryWindowId: number | null;
  readonly quitting: boolean;
}

export const emptyWindowModelState = (): WindowModelState => ({
  appWindows: new Map(),
  gameWindows: new Map(),
  gameChildWindows: new Map(),
  parentGameWindowIds: new Map(),
  windowContexts: new Map(),
  forceClosingWindowIds: new Set(),
  inFlightOpenKeys: new Set(),
  lastFocusedGameWindowId: null,
  lastFocusedPrimaryWindowId: null,
  quitting: false,
});

const cloneChildWindows = (
  current: ReadonlyMap<number, ReadonlyMap<WindowId, GameChildWindowRef>>,
): Map<number, Map<WindowId, GameChildWindowRef>> =>
  new Map(
    Array.from(current.entries()).map(([gameWindowId, children]) => [
      gameWindowId,
      new Map(children),
    ]),
  );

export const appOpenKey = (id: WindowId): string => `app:${id}`;

export const gameChildOpenKey = (gameWindowId: number, id: WindowId): string =>
  `game-child:${gameWindowId}:${id}`;

export const registerInFlightOpen = (
  state: WindowModelState,
  key: string,
): WindowModelState => ({
  ...state,
  inFlightOpenKeys: new Set([...state.inFlightOpenKeys, key]),
});

export const completeInFlightOpen = (
  state: WindowModelState,
  key: string,
): WindowModelState => {
  const inFlightOpenKeys = new Set(state.inFlightOpenKeys);
  inFlightOpenKeys.delete(key);
  return { ...state, inFlightOpenKeys };
};

export const registerAppWindow = (
  state: WindowModelState,
  input: {
    readonly id: WindowId;
    readonly windowId: number;
    readonly context: unknown;
  },
): { readonly state: WindowModelState; readonly ref: AppWindowRef } => {
  const ref = makeAppWindowRef(input.id, input.windowId);
  const appWindows = new Map(state.appWindows);
  const windowContexts = new Map(state.windowContexts);
  appWindows.set(input.id, ref);
  windowContexts.set(input.windowId, input.context);
  return { ref, state: { ...state, appWindows, windowContexts } };
};

export const registerGameWindow = (
  state: WindowModelState,
  input: { readonly windowId: number; readonly context: unknown },
): { readonly state: WindowModelState; readonly ref: GameWindowRef } => {
  const ref = makeGameWindowRef(input.windowId);
  const gameWindows = new Map(state.gameWindows);
  const gameChildWindows = cloneChildWindows(state.gameChildWindows);
  const windowContexts = new Map(state.windowContexts);
  gameWindows.set(input.windowId, ref);
  gameChildWindows.set(input.windowId, new Map());
  windowContexts.set(input.windowId, input.context);
  return {
    ref,
    state: { ...state, gameWindows, gameChildWindows, windowContexts },
  };
};

export const registerGameChildWindow = (
  state: WindowModelState,
  input: {
    readonly gameWindowId: number;
    readonly id: WindowId;
    readonly windowId: number;
    readonly context: unknown;
  },
): { readonly state: WindowModelState; readonly ref: GameChildWindowRef } => {
  const ref = makeGameChildWindowRef(
    input.gameWindowId,
    input.id,
    input.windowId,
  );
  const gameChildWindows = cloneChildWindows(state.gameChildWindows);
  const children = gameChildWindows.get(input.gameWindowId) ?? new Map();
  const parentGameWindowIds = new Map(state.parentGameWindowIds);
  const windowContexts = new Map(state.windowContexts);
  children.set(input.id, ref);
  gameChildWindows.set(input.gameWindowId, children);
  parentGameWindowIds.set(input.windowId, input.gameWindowId);
  windowContexts.set(input.windowId, input.context);
  return {
    ref,
    state: {
      ...state,
      gameChildWindows,
      parentGameWindowIds,
      windowContexts,
    },
  };
};

export const removeAppWindow = (
  state: WindowModelState,
  id: WindowId,
  windowId: number,
): WindowModelState => {
  const appWindows = new Map(state.appWindows);
  const windowContexts = new Map(state.windowContexts);
  const current = appWindows.get(id);
  if (current?.windowId === windowId) {
    appWindows.delete(id);
  }
  windowContexts.delete(windowId);
  return {
    ...state,
    appWindows,
    windowContexts,
    lastFocusedPrimaryWindowId:
      state.lastFocusedPrimaryWindowId === windowId
        ? null
        : state.lastFocusedPrimaryWindowId,
  };
};

export const removeGameChildWindow = (
  state: WindowModelState,
  gameWindowId: number,
  id: WindowId,
  windowId: number,
): WindowModelState => {
  const gameChildWindows = cloneChildWindows(state.gameChildWindows);
  const parentGameWindowIds = new Map(state.parentGameWindowIds);
  const windowContexts = new Map(state.windowContexts);
  const forceClosingWindowIds = new Set(state.forceClosingWindowIds);
  gameChildWindows.get(gameWindowId)?.delete(id);
  parentGameWindowIds.delete(windowId);
  windowContexts.delete(windowId);
  forceClosingWindowIds.delete(windowId);
  return {
    ...state,
    forceClosingWindowIds,
    gameChildWindows,
    parentGameWindowIds,
    windowContexts,
  };
};

export const removeGameWindow = (
  state: WindowModelState,
  gameWindowId: number,
): WindowModelState => {
  const gameWindows = new Map(state.gameWindows);
  const gameChildWindows = cloneChildWindows(state.gameChildWindows);
  const parentGameWindowIds = new Map(state.parentGameWindowIds);
  const windowContexts = new Map(state.windowContexts);

  for (const child of gameChildWindows.get(gameWindowId)?.values() ?? []) {
    parentGameWindowIds.delete(child.windowId);
    windowContexts.delete(child.windowId);
  }

  gameWindows.delete(gameWindowId);
  gameChildWindows.delete(gameWindowId);
  windowContexts.delete(gameWindowId);

  return {
    ...state,
    gameChildWindows,
    gameWindows,
    lastFocusedGameWindowId:
      state.lastFocusedGameWindowId === gameWindowId
        ? null
        : state.lastFocusedGameWindowId,
    lastFocusedPrimaryWindowId:
      state.lastFocusedPrimaryWindowId === gameWindowId
        ? null
        : state.lastFocusedPrimaryWindowId,
    parentGameWindowIds,
    windowContexts,
  };
};

export const markGameWindowFocused = (
  state: WindowModelState,
  gameWindowId: number,
): WindowModelState => ({
  ...state,
  lastFocusedGameWindowId: gameWindowId,
  lastFocusedPrimaryWindowId: gameWindowId,
});

export const markPrimaryWindowFocused = (
  state: WindowModelState,
  windowId: number,
): WindowModelState => ({
  ...state,
  lastFocusedPrimaryWindowId: windowId,
});

export const setQuitting = (
  state: WindowModelState,
  quitting: boolean,
): WindowModelState => ({ ...state, quitting });

export const markForceClosing = (
  state: WindowModelState,
  windowIds: Iterable<number>,
): WindowModelState => ({
  ...state,
  forceClosingWindowIds: new Set([
    ...state.forceClosingWindowIds,
    ...windowIds,
  ]),
});

export const resolveGameWindowId = (
  state: WindowModelState,
  windowId: number,
): number | undefined =>
  state.gameWindows.has(windowId)
    ? windowId
    : state.parentGameWindowIds.get(windowId);

export const resolveGameWindowRef = (
  state: WindowModelState,
  windowId: number,
): GameWindowRef | undefined => {
  const gameWindowId = resolveGameWindowId(state, windowId);
  return gameWindowId === undefined
    ? undefined
    : state.gameWindows.get(gameWindowId);
};

export const resolveCatalogWindowRef = (
  state: WindowModelState,
  id: WindowId,
): CatalogWindowRef | null => {
  const appWindow = state.appWindows.get(id);
  if (appWindow) {
    return appWindow;
  }

  for (const children of state.gameChildWindows.values()) {
    const childWindow = children.get(id);
    if (childWindow) {
      return childWindow;
    }
  }

  return null;
};

export const resolveFirstGameWindowRef = (
  state: WindowModelState,
  isUsable: (ref: GameWindowRef) => boolean,
): GameWindowRef | null => {
  for (const ref of state.gameWindows.values()) {
    if (isUsable(ref)) {
      return ref;
    }
  }
  return null;
};

export const resolvePreferredGameWindowRef = (
  state: WindowModelState,
  input: {
    readonly senderWindowId?: number;
    readonly isUsable: (ref: GameWindowRef) => boolean;
  },
): GameWindowRef | null => {
  const candidates = [
    input.senderWindowId === undefined
      ? undefined
      : resolveGameWindowId(state, input.senderWindowId),
    state.lastFocusedGameWindowId,
    undefined,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const ref = state.gameWindows.get(candidate);
    if (ref && input.isUsable(ref)) {
      return ref;
    }
  }

  return resolveFirstGameWindowRef(state, input.isUsable);
};

export const isPrimaryWindowRef = (ref: ManagedWindowRef): boolean =>
  ref.kind === "game" ||
  (ref.kind === "app" && ref.id === WindowIds.AccountManager);

export const shouldQuitAfterGameWindowClosed = (
  state: WindowModelState,
  input: {
    readonly hasUsableGameWindow: boolean;
    readonly isAccountManagerHidden: boolean;
  },
): boolean =>
  !state.quitting && !input.hasUsableGameWindow && input.isAccountManagerHidden;

export const shouldHideOnClose = (
  state: WindowModelState,
  input: {
    readonly closeBehavior: "destroy" | "hide";
    readonly windowId: number;
  },
): boolean =>
  !state.quitting &&
  !state.forceClosingWindowIds.has(input.windowId) &&
  input.closeBehavior === "hide";
