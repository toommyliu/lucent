import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Event as ElectronEvent,
} from "electron";
import { pathToFileURL } from "url";
import { Deferred, Effect, Layer, Ref } from "effect";
import {
  appendAppearanceSnapshotToUrl,
  serializeAppearanceSnapshotArgument,
  type AppearanceSnapshot,
} from "../../shared/appearance-snapshot";
import { serializeSettingsSnapshotArgument } from "../../shared/settings-snapshot";
import type { AppSettings } from "../../shared/settings";
import { serializePreloadWindowContextArgument } from "../../shared/window-startup-context";
import {
  getWindowDefinition,
  isAppWindowDefinition,
  isGameChildWindowDefinition,
  isWindowId,
  WindowIds,
  type WindowDefinition,
  type WindowId,
} from "../../shared/windows";
import {
  appOpenKey,
  completeInFlightOpen,
  emptyWindowModelState,
  gameChildOpenKey,
  markForceClosing,
  markGameWindowFocused,
  markPrimaryWindowFocused,
  registerAppWindow,
  registerGameChildWindow,
  registerGameWindow,
  registerInFlightOpen,
  removeAppWindow,
  removeGameChildWindow,
  removeGameWindow,
  resolveCatalogWindowRef,
  resolveGameWindowRef,
  resolvePreferredGameWindowRef,
  setQuitting as setModelQuitting,
  shouldHideOnClose,
  shouldQuitAfterGameWindowClosed,
  type WindowModelState,
} from "./WindowModel";
import { makeElectronWindowRuntime } from "./WindowRuntime";
import {
  bindFirstRevealTrigger,
  revealWindow,
  type RevealSubscription,
} from "./WindowReveal";
import {
  getWindowRefId,
  makeGameWindowRef,
  MissingParentGameWindowError,
  StaleWindowRefError,
  UnknownWindowDefinitionError,
  UnsupportedWindowDefinitionError,
  WindowCreateError,
  WindowEnvironmentService,
  WindowLifecycleHooks,
  WindowLoadError,
  WindowOperationError,
  WindowService,
  WindowSnapshotService,
  type AppWindowRef,
  type CatalogWindowRef,
  type GameChildWindowRef,
  type GameWindowRef,
  type ManagedWindowRef,
  type WindowEnvironment,
  type WindowManagerError,
  type WindowServiceShape,
  type WindowStartupContext,
  makeAppWindowRef,
  makeGameChildWindowRef,
} from "./WindowTypes";

export {
  getRendererGameWindowPath,
  getRendererWindowPath,
} from "./WindowPaths";
export { makeElectronWindowRuntime } from "./WindowRuntime";
export {
  bindFirstRevealTrigger,
  revealWindow,
  type RevealSubscription,
} from "./WindowReveal";
export {
  makeAppWindowRef,
  makeGameChildWindowRef,
  makeGameWindowRef,
  MissingParentGameWindowError,
  StaleWindowRefError,
  UnknownWindowDefinitionError,
  UnsupportedWindowDefinitionError,
  WindowCreateError,
  WindowEnvironmentService,
  WindowLifecycleHooks,
  WindowLoadError,
  WindowOperationError,
  WindowSenderAuthorizationError,
  WindowService,
  WindowSnapshotService,
  type AppWindowRef,
  type CatalogWindowRef,
  type ElectronWindowRuntime,
  type GameChildWindowRef,
  type GameWindowRef,
  type ManagedWindowRef,
  type WindowEffectRunner,
  type WindowEnvironment,
  type WindowManagerError,
  type WindowServiceShape,
  type WindowStartupContext,
} from "./WindowTypes";

type OpenDeferred = Deferred.Deferred<CatalogWindowRef, WindowManagerError>;

interface HandleState {
  readonly appWindows: Map<WindowId, BrowserWindow>;
  readonly gameWindows: Map<number, BrowserWindow>;
  readonly gameChildWindows: Map<number, Map<WindowId, BrowserWindow>>;
}

const makeHandleState = (): HandleState => ({
  appWindows: new Map(),
  gameWindows: new Map(),
  gameChildWindows: new Map(),
});

const isWindowOpen = (
  window: BrowserWindow | null | undefined,
): window is BrowserWindow => Boolean(window && !window.isDestroyed());

const isWindowUsable = (
  window: BrowserWindow | null | undefined,
): window is BrowserWindow =>
  Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());

const isWindowPresented = (
  window: BrowserWindow | null | undefined,
): window is BrowserWindow =>
  Boolean(
    isWindowUsable(window) && window.isVisible() && !window.isMinimized(),
  );

const isWindowHidden = (
  window: BrowserWindow | null | undefined,
): window is BrowserWindow =>
  Boolean(
    isWindowUsable(window) && !window.isVisible() && !window.isMinimized(),
  );

const createLoadFailure = (
  target: string,
  kind: "file" | "url",
  cause: unknown,
) =>
  new WindowLoadError({
    message: `Failed to load ${kind} target: ${target}`,
    target,
    kind,
    cause,
  });

const loadWindow = (
  window: BrowserWindow,
  target: string,
  kind: "file" | "url",
) =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        let settled = false;

        const cleanup = (): void => {
          window.removeListener("closed", handleClosed);
        };
        const settle = (complete: () => void): void => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          complete();
        };
        const rejectClosed = (): void => {
          settle(() => {
            reject(new Error("Window closed before renderer finished loading"));
          });
        };
        const handleClosed = (): void => {
          rejectClosed();
        };

        if (window.isDestroyed() || window.webContents.isDestroyed()) {
          rejectClosed();
          return;
        }

        window.once("closed", handleClosed);
        Promise.resolve()
          .then(() =>
            kind === "url" ? window.loadURL(target) : window.loadFile(target),
          )
          .then(
            () => {
              if (window.isDestroyed() || window.webContents.isDestroyed()) {
                rejectClosed();
                return;
              }

              settle(() => resolve());
            },
            (cause: unknown) => {
              settle(() => reject(cause));
            },
          );
      }),
    catch: (cause) => createLoadFailure(target, kind, cause),
  });

const createWebPreferences = (
  env: WindowEnvironment,
  context: WindowStartupContext,
  appearanceSnapshot: AppearanceSnapshot,
  settingsSnapshot: AppSettings,
  options?: { readonly plugins?: boolean },
): NonNullable<BrowserWindowConstructorOptions["webPreferences"]> => ({
  preload: env.preloadPath,
  nodeIntegration: false,
  contextIsolation: true,
  additionalArguments: [
    serializePreloadWindowContextArgument(context),
    serializeAppearanceSnapshotArgument(appearanceSnapshot),
    serializeSettingsSnapshotArgument(settingsSnapshot),
  ],
  ...(options?.plugins ? { plugins: true } : {}),
});

type WindowOpenHandlerWebContents = BrowserWindow["webContents"] & {
  readonly setWindowOpenHandler?: (
    handler: () => { readonly action: "deny" },
  ) => void;
};

const denyRendererWindowOpen = (window: BrowserWindow): void => {
  const webContents = window.webContents as WindowOpenHandlerWebContents;
  if (typeof webContents.setWindowOpenHandler === "function") {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }

  webContents.on("new-window", (event: ElectronEvent) => {
    event.preventDefault();
  });
};

const createGameWindowOptions = (
  env: WindowEnvironment,
  context: WindowStartupContext,
  appearanceSnapshot: AppearanceSnapshot,
  settingsSnapshot: AppSettings,
): BrowserWindowConstructorOptions => ({
  backgroundColor: appearanceSnapshot.backgroundColor,
  ...(env.platform === "linux" ? { icon: env.appIconPath } : {}),
  width: 1024,
  height: 768,
  show: false,
  webPreferences: createWebPreferences(
    env,
    context,
    appearanceSnapshot,
    settingsSnapshot,
    {
      plugins: true,
    },
  ),
});

const createCatalogWindowOptions = (
  env: WindowEnvironment,
  definition: WindowDefinition,
  context: WindowStartupContext,
  appearanceSnapshot: AppearanceSnapshot,
  settingsSnapshot: AppSettings,
): BrowserWindowConstructorOptions => {
  const options: BrowserWindowConstructorOptions = {
    backgroundColor: appearanceSnapshot.backgroundColor,
    ...(env.platform === "linux" ? { icon: env.appIconPath } : {}),
    title: definition.label,
    width: definition.dimensions.width,
    height: definition.dimensions.height,
    show: false,
    webPreferences: createWebPreferences(
      env,
      context,
      appearanceSnapshot,
      settingsSnapshot,
    ),
  };

  if (typeof definition.dimensions.minWidth === "number") {
    options.minWidth = definition.dimensions.minWidth;
  }

  if (typeof definition.dimensions.minHeight === "number") {
    options.minHeight = definition.dimensions.minHeight;
  }

  return options;
};

const requireWindowDefinition = (
  id: WindowId,
): Effect.Effect<WindowDefinition, WindowManagerError> => {
  if (!isWindowId(id)) {
    return Effect.fail(
      new UnknownWindowDefinitionError({
        id,
        message: `Unknown window: ${String(id)}`,
      }),
    );
  }

  const definition = getWindowDefinition(id);
  if (!definition) {
    return Effect.fail(
      new UnknownWindowDefinitionError({
        id,
        message: `Missing window definition: ${id}`,
      }),
    );
  }

  return Effect.succeed(definition);
};

const getRefWindow = (
  handles: HandleState,
  ref: ManagedWindowRef,
): BrowserWindow | null => {
  if (ref.kind === "game") {
    return handles.gameWindows.get(ref.id) ?? null;
  }

  if (ref.kind === "app") {
    return handles.appWindows.get(ref.id) ?? null;
  }

  return handles.gameChildWindows.get(ref.gameWindowId)?.get(ref.id) ?? null;
};

const getUsableRefWindow = (
  handles: HandleState,
  ref: ManagedWindowRef,
): BrowserWindow | null => {
  const window = getRefWindow(handles, ref);
  return isWindowUsable(window) ? window : null;
};

const staleRefError = (ref: ManagedWindowRef): StaleWindowRefError =>
  new StaleWindowRefError({
    ref,
    message: `Window is no longer open: ${ref.kind}:${getWindowRefId(ref)}`,
  });

const makeWindowService = Effect.gen(function* () {
  const env = yield* WindowEnvironmentService;
  const hooks = yield* WindowLifecycleHooks;
  const snapshots = yield* WindowSnapshotService;
  const runtime = makeElectronWindowRuntime();
  const stateRef = yield* Ref.make<WindowModelState>(emptyWindowModelState());
  const handles = makeHandleState();
  const inFlightOpens = new Map<string, OpenDeferred>();

  const getSnapshotInputs = Effect.gen(function* () {
    const settingsSnapshot = yield* snapshots.getSettingsSnapshot;
    const appearanceSnapshot =
      yield* snapshots.getAppearanceSnapshot(settingsSnapshot);
    return { appearanceSnapshot, settingsSnapshot };
  });

  const updateState = (f: (state: WindowModelState) => WindowModelState) =>
    Ref.update(stateRef, f);

  const createManagedWindow = (
    options: BrowserWindowConstructorOptions,
  ): Effect.Effect<BrowserWindow, WindowManagerError> =>
    Effect.try({
      try: () => {
        const position =
          typeof options.width === "number" &&
          typeof options.height === "number"
            ? runtime.getCenteredPosition(options.width, options.height)
            : {};

        const window = runtime.createWindow({
          ...position,
          useContentSize: true,
          ...options,
        });

        denyRendererWindowOpen(window);

        if (env.isDev) {
          window.webContents.openDevTools({ mode: "right" });
        }

        return window;
      },
      catch: (cause) =>
        new WindowCreateError({
          message: "Failed to create browser window",
          cause,
        }),
    });

  const revealWhenReady = (window: BrowserWindow): void => {
    const subscribers: RevealSubscription[] = [
      (fire) => window.once("ready-to-show", fire),
    ];

    if (runtime.platform === "linux") {
      subscribers.push((fire) =>
        window.webContents.once("did-finish-load", fire),
      );
    }

    bindFirstRevealTrigger(subscribers, () => revealWindow(runtime, window));
  };

  const revealRef = (
    ref: ManagedWindowRef,
  ): Effect.Effect<void, WindowManagerError> =>
    Effect.gen(function* () {
      const window = getUsableRefWindow(handles, ref);
      if (!window) {
        return yield* staleRefError(ref);
      }

      yield* Effect.sync(() => {
        revealWindow(runtime, window);
      });
    });

  const destroyWindow = (window: BrowserWindow): void => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  };

  const getGameChildHandles = (gameWindowId: number): BrowserWindow[] =>
    Array.from(handles.gameChildWindows.get(gameWindowId)?.values() ?? []);

  const destroyChildWindows = (gameWindowId: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      const childWindows = getGameChildHandles(gameWindowId);
      yield* updateState((state) =>
        markForceClosing(
          state,
          childWindows.map((window) => window.id),
        ),
      );

      for (const childWindow of childWindows) {
        destroyWindow(childWindow);
      }

      handles.gameChildWindows.delete(gameWindowId);
    });

  const hasUsableGameWindow = (): boolean => {
    for (const window of handles.gameWindows.values()) {
      if (isWindowUsable(window)) {
        return true;
      }
    }

    return false;
  };

  const resolveAccountManagerWindow = (): BrowserWindow | null => {
    const window = handles.appWindows.get(WindowIds.AccountManager);
    return isWindowUsable(window) ? window : null;
  };

  const quitIfOnlyHiddenAccountManagerRemains = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (
        shouldQuitAfterGameWindowClosed(state, {
          hasUsableGameWindow: hasUsableGameWindow(),
          isAccountManagerHidden: isWindowHidden(resolveAccountManagerWindow()),
        })
      ) {
        yield* hooks.quitApp;
      }
    });

  const loadGameRenderer = (
    window: BrowserWindow,
    appearanceSnapshot: AppearanceSnapshot,
  ): Effect.Effect<void, WindowManagerError> =>
    loadWindow(
      window,
      appendAppearanceSnapshotToUrl(
        pathToFileURL(env.gameWindowHtmlPath),
        appearanceSnapshot,
      ),
      "url",
    );

  const loadCatalogRenderer = (
    window: BrowserWindow,
    definition: WindowDefinition,
    appearanceSnapshot: AppearanceSnapshot,
  ): Effect.Effect<void, WindowManagerError> => {
    const url = appendAppearanceSnapshotToUrl(
      pathToFileURL(env.windowHtmlPath(definition.id)),
      appearanceSnapshot,
    );
    return loadWindow(window, url, "url");
  };

  const resolveOrCreateGameWindow = (
    senderWindowId?: number,
  ): Effect.Effect<GameWindowRef, WindowManagerError> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      const resolved = resolvePreferredGameWindowRef(state, {
        ...(senderWindowId === undefined ? {} : { senderWindowId }),
        isUsable: (ref) => isWindowUsable(handles.gameWindows.get(ref.id)),
      });
      if (resolved) {
        return resolved;
      }

      return yield* openGameWindow();
    });

  const openGameWindow: WindowServiceShape["openGameWindow"] = (options) =>
    Effect.gen(function* () {
      const { appearanceSnapshot, settingsSnapshot } = yield* getSnapshotInputs;
      const context = {
        kind: "game",
        label: "Game",
      } satisfies WindowStartupContext;
      const window = yield* createManagedWindow({
        ...createGameWindowOptions(
          env,
          context,
          appearanceSnapshot,
          settingsSnapshot,
        ),
        ...(options?.bounds === undefined ? {} : { useContentSize: false }),
        ...options?.bounds,
      });

      const registration = yield* Ref.modify(stateRef, (state) => {
        const result = registerGameWindow(state, {
          context,
          windowId: window.id,
        });
        return [result, result.state];
      });
      const { ref } = registration;
      const gameWindowId = ref.id;
      handles.gameWindows.set(ref.id, window);
      revealWhenReady(window);

      yield* hooks.onWindowCreated(ref, window, context);
      yield* hooks.onGameWindowCreated(ref, window);

      window.on("focus", () => {
        Effect.runSync(
          updateState((state) => markGameWindowFocused(state, gameWindowId)),
        );
      });

      window.on("close", () => {
        void Effect.runPromise(destroyChildWindows(gameWindowId));
      });

      window.on("closed", () => {
        void Effect.runPromise(
          Effect.gen(function* () {
            yield* destroyChildWindows(gameWindowId);
            handles.gameWindows.delete(gameWindowId);
            yield* updateState((state) => removeGameWindow(state, gameWindowId));
            yield* quitIfOnlyHiddenAccountManagerRemains();
          }),
        );
      });

      yield* loadGameRenderer(window, appearanceSnapshot).pipe(
        Effect.catch((error: WindowManagerError) =>
          Effect.sync(() => {
            handles.gameWindows.delete(gameWindowId);
            destroyWindow(window);
          }).pipe(
            Effect.flatMap(() =>
              updateState((state) => removeGameWindow(state, gameWindowId)),
            ),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );

      return ref;
    });

  const runDedupeOpen = (
    key: string,
    open: Effect.Effect<CatalogWindowRef, WindowManagerError>,
  ): Effect.Effect<CatalogWindowRef, WindowManagerError> =>
    Effect.gen(function* () {
      const existing = inFlightOpens.get(key);
      if (existing) {
        return yield* Deferred.await(existing);
      }

      const deferred = yield* Deferred.make<
        CatalogWindowRef,
        WindowManagerError
      >();
      inFlightOpens.set(key, deferred);
      yield* updateState((state) => registerInFlightOpen(state, key));

      return yield* open.pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Deferred.fail(deferred, error).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          onSuccess: (ref) =>
            Deferred.succeed(deferred, ref).pipe(Effect.as(ref)),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            inFlightOpens.delete(key);
          }).pipe(
            Effect.flatMap(() =>
              updateState((state) => completeInFlightOpen(state, key)),
            ),
          ),
        ),
      );
    });

  const openGameChildWindow = (
    gameRef: GameWindowRef,
    definition: WindowDefinition,
  ): Effect.Effect<GameChildWindowRef, WindowManagerError> =>
    runDedupeOpen(
      gameChildOpenKey(gameRef.id, definition.id),
      Effect.gen(function* () {
        const gameWindow = handles.gameWindows.get(gameRef.id);
        if (!isWindowUsable(gameWindow)) {
          return yield* new MissingParentGameWindowError({
            gameWindowId: gameRef.id,
            message: "Game window is no longer usable",
          });
        }

        const existing = handles.gameChildWindows
          .get(gameRef.id)
          ?.get(definition.id);
        if (isWindowOpen(existing)) {
          revealWindow(runtime, existing);
          return makeGameChildWindowRef(gameRef.id, definition.id, existing.id);
        }

        const { appearanceSnapshot, settingsSnapshot } =
          yield* getSnapshotInputs;
        const context = {
          kind: "game-child",
          id: definition.id,
          label: definition.label,
        } satisfies WindowStartupContext;
        const childWindow = yield* createManagedWindow(
          createCatalogWindowOptions(
            env,
            definition,
            context,
            appearanceSnapshot,
            settingsSnapshot,
          ),
        );
        const registration = yield* Ref.modify(stateRef, (state) => {
          const result = registerGameChildWindow(state, {
            context,
            gameWindowId: gameRef.id,
            id: definition.id,
            windowId: childWindow.id,
          });
          return [result, result.state];
        });
        const { ref } = registration;
        const childWindowId = ref.windowId;
        const children = handles.gameChildWindows.get(gameRef.id) ?? new Map();
        children.set(definition.id, childWindow);
        handles.gameChildWindows.set(gameRef.id, children);
        revealWhenReady(childWindow);
        yield* hooks.onWindowCreated(ref, childWindow, context);

        childWindow.on("close", (event: ElectronEvent) => {
          const state = Ref.getUnsafe(stateRef);
          if (
            shouldHideOnClose(state, {
              closeBehavior: definition.closeBehavior,
              windowId: childWindowId,
            })
          ) {
            event.preventDefault();
            childWindow.hide();
          }
        });

        childWindow.on("closed", () => {
          children.delete(definition.id);
          void Effect.runPromise(
            updateState((state) =>
              removeGameChildWindow(
                state,
                gameRef.id,
                definition.id,
                childWindowId,
              ),
            ),
          );
        });

        yield* loadCatalogRenderer(
          childWindow,
          definition,
          appearanceSnapshot,
        ).pipe(
          Effect.catch((error: WindowManagerError) =>
            Effect.sync(() => {
              children.delete(definition.id);
              destroyWindow(childWindow);
            }).pipe(
              Effect.flatMap(() =>
                updateState((state) =>
                  removeGameChildWindow(
                    state,
                    gameRef.id,
                    definition.id,
                    childWindowId,
                  ),
                ),
              ),
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
        );

        return ref;
      }),
    ) as Effect.Effect<GameChildWindowRef, WindowManagerError>;

  const openAppWindow = (
    definition: WindowDefinition,
  ): Effect.Effect<AppWindowRef, WindowManagerError> =>
    runDedupeOpen(
      appOpenKey(definition.id),
      Effect.gen(function* () {
        const existing = handles.appWindows.get(definition.id);
        if (isWindowOpen(existing)) {
          revealWindow(runtime, existing);
          return makeAppWindowRef(definition.id, existing.id);
        }

        const { appearanceSnapshot, settingsSnapshot } =
          yield* getSnapshotInputs;
        const context = {
          kind: "app",
          id: definition.id,
          label: definition.label,
        } satisfies WindowStartupContext;
        const appWindow = yield* createManagedWindow(
          createCatalogWindowOptions(
            env,
            definition,
            context,
            appearanceSnapshot,
            settingsSnapshot,
          ),
        );
        const registration = yield* Ref.modify(stateRef, (state) => {
          const result = registerAppWindow(state, {
            context,
            id: definition.id,
            windowId: appWindow.id,
          });
          return [result, result.state];
        });
        const { ref } = registration;
        const appWindowId = ref.windowId;
        handles.appWindows.set(definition.id, appWindow);
        revealWhenReady(appWindow);
        yield* hooks.onWindowCreated(ref, appWindow, context);

        if (definition.id === WindowIds.AccountManager) {
          appWindow.on("focus", () => {
            Effect.runSync(
              updateState((state) =>
                markPrimaryWindowFocused(state, appWindowId),
              ),
            );
          });
        }

        appWindow.on("close", (event: ElectronEvent) => {
          const state = Ref.getUnsafe(stateRef);
          if (
            definition.id === WindowIds.AccountManager &&
            !state.quitting &&
            !hasUsableGameWindow()
          ) {
            void Effect.runPromise(hooks.quitApp);
            return;
          }

          if (
            shouldHideOnClose(state, {
              closeBehavior: definition.closeBehavior,
              windowId: appWindowId,
            })
          ) {
            event.preventDefault();
            appWindow.hide();
          }
        });

        appWindow.on("closed", () => {
          const current = handles.appWindows.get(definition.id);
          if (current === appWindow) {
            handles.appWindows.delete(definition.id);
          }
          void Effect.runPromise(
            updateState((state) =>
              removeAppWindow(state, definition.id, appWindowId),
            ),
          );
        });

        yield* loadCatalogRenderer(
          appWindow,
          definition,
          appearanceSnapshot,
        ).pipe(
          Effect.catch((error: WindowManagerError) =>
            Effect.sync(() => {
              handles.appWindows.delete(definition.id);
              destroyWindow(appWindow);
            }).pipe(
            Effect.flatMap(() =>
              updateState((state) =>
                removeAppWindow(state, definition.id, appWindowId),
              ),
            ),
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
        );

        return ref;
      }),
    ) as Effect.Effect<AppWindowRef, WindowManagerError>;

  const openWindow: WindowServiceShape["openWindow"] = (id, senderWindowId) =>
    Effect.gen(function* () {
      const definition = yield* requireWindowDefinition(id);

      if (isAppWindowDefinition(definition)) {
        return yield* openAppWindow(definition);
      }

      if (isGameChildWindowDefinition(definition)) {
        const gameWindow = yield* resolveOrCreateGameWindow(senderWindowId);
        return yield* openGameChildWindow(gameWindow, definition);
      }

      return yield* new UnsupportedWindowDefinitionError({
        id,
        scope: definition.scope,
        message: `Unsupported window scope: ${definition.scope}`,
      });
    });

  const getOpenWindow: WindowServiceShape["getOpenWindow"] = (id) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      const ref = resolveCatalogWindowRef(state, id);
      return ref && getUsableRefWindow(handles, ref) ? ref : null;
    });

  const getGameWindowRefById: WindowServiceShape["getGameWindowRefById"] = (
    gameWindowId,
  ) =>
    Effect.gen(function* () {
      const ref = makeGameWindowRef(gameWindowId);
      return getUsableRefWindow(handles, ref) ? ref : null;
    });

  const getGameChildWindowRef: WindowServiceShape["getGameChildWindowRef"] = (
    gameWindowId,
    id,
  ) =>
    Effect.gen(function* () {
      const child = handles.gameChildWindows.get(gameWindowId)?.get(id);
      if (!isWindowUsable(child)) {
        return null;
      }
      return makeGameChildWindowRef(gameWindowId, id, child.id);
    });

  const hasPresentedPrimaryWindow = (): boolean => {
    if (isWindowPresented(resolveAccountManagerWindow())) {
      return true;
    }

    for (const window of handles.gameWindows.values()) {
      if (isWindowPresented(window)) {
        return true;
      }
    }

    return false;
  };

  const resolveLastFocusedPrimaryWindow = (): BrowserWindow | null => {
    const state = Ref.getUnsafe(stateRef);
    if (state.lastFocusedPrimaryWindowId === null) {
      return null;
    }

    const window = runtime.fromId(state.lastFocusedPrimaryWindowId);
    if (!isWindowUsable(window)) {
      return null;
    }

    if (handles.gameWindows.get(window.id) === window) {
      return window;
    }

    return handles.appWindows.get(WindowIds.AccountManager) === window
      ? window
      : null;
  };

  return {
    getCursorDisplayWorkArea: () =>
      Effect.try({
        try: () => runtime.getCursorDisplayWorkArea(),
        catch: (cause) =>
          new WindowOperationError({
            message: "Failed to resolve cursor display work area",
            cause,
          }),
      }),
    getGameChildWindowRef,
    getGameWindowRef: (windowId) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const ref = resolveGameWindowRef(state, windowId);
        return ref && getUsableRefWindow(handles, ref) ? ref : undefined;
      }),
    getGameWindowRefById,
    getGameWindowRefs: () =>
      Effect.sync(() =>
        Array.from(handles.gameWindows.entries())
          .filter(([, window]) => isWindowUsable(window))
          .map(([gameWindowId]) => makeGameWindowRef(gameWindowId)),
      ),
    getOpenWindow,
    getWindowContext: (windowId) =>
      Ref.get(stateRef).pipe(
        Effect.map(
          (state) =>
            state.windowContexts.get(windowId) as
              | WindowStartupContext
              | undefined,
        ),
      ),
    onWindowClosed: (ref, listener) =>
      Effect.gen(function* () {
        const window = getUsableRefWindow(handles, ref);
        if (!window) {
          return yield* staleRefError(ref);
        }

        yield* Effect.sync(() => {
          window.once("closed", listener);
        });
        return () => {
          window.removeListener("closed", listener);
        };
      }),
    openGameWindow,
    openWindow,
    requestCloseGameWindow: (ref) =>
      Effect.gen(function* () {
        const window = getRefWindow(handles, ref);
        if (!isWindowOpen(window)) {
          return;
        }

        yield* Effect.sync(() => {
          setTimeout(() => {
            if (!window.isDestroyed()) {
              window.close();
            }
          }, 0);
        });
      }),
    revealGameWindow: () =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const gameWindow = resolvePreferredGameWindowRef(state, {
          isUsable: (ref) => isWindowUsable(handles.gameWindows.get(ref.id)),
        });
        if (gameWindow) {
          yield* revealRef(gameWindow);
          return;
        }

        yield* openGameWindow();
      }).pipe(Effect.asVoid),
    revealWindow: revealRef,
    revealWindowForAppActivation: () =>
      Effect.gen(function* () {
        if (hasPresentedPrimaryWindow()) {
          return;
        }

        const lastFocusedPrimaryWindow = resolveLastFocusedPrimaryWindow();
        if (lastFocusedPrimaryWindow) {
          revealWindow(runtime, lastFocusedPrimaryWindow);
          return;
        }

        const accountManagerWindow = resolveAccountManagerWindow();
        if (accountManagerWindow) {
          revealWindow(runtime, accountManagerWindow);
          return;
        }

        const state = yield* Ref.get(stateRef);
        const gameWindow = resolvePreferredGameWindowRef(state, {
          isUsable: (ref) => isWindowUsable(handles.gameWindows.get(ref.id)),
        });
        if (gameWindow) {
          yield* revealRef(gameWindow);
          return;
        }

        yield* openGameWindow();
      }).pipe(Effect.asVoid),
    sendToWindow: (ref, channel, ...args) =>
      Effect.gen(function* () {
        const window = getUsableRefWindow(handles, ref);
        if (!window) {
          return yield* staleRefError(ref);
        }

        return yield* Effect.try({
          try: () => {
            window.webContents.send(channel, ...args);
            return true;
          },
          catch: (cause) =>
            new WindowOperationError({
              message: `Failed to send IPC message to window: ${channel}`,
              cause,
            }),
        });
      }),
    setQuitting: (quitting) =>
      updateState((state) => setModelQuitting(state, quitting)),
  } satisfies WindowServiceShape;
});

export const WindowServiceLive = Layer.effect(WindowService, makeWindowService);
export const layer = WindowServiceLive;
