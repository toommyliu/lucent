import { randomBytes } from "crypto";
import type {
  RenderProcessGoneDetails,
  Event as ElectronEvent,
} from "electron";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import appBranding from "../../../appBranding.json";
import type {
  GameViewHostState,
  GameViewLayout,
  GameViewPresentation,
  GameViewSelectionFocus,
} from "../../shared/gameViews";
import { GameViewsIpc } from "../../shared/ipc";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ElectronApp } from "../electron/ElectronApp";
import { observeElectronEvent } from "../electron/ElectronScope";
import {
  isElectronWindowUsable,
  type ElectronNativeWindowHandle,
} from "../electron/ElectronWindow";
import { DesktopSettings } from "../settings/DesktopSettings";
import {
  getDesktopWindowDefinition,
  type DesktopRendererKind,
  type DesktopWindowKind,
} from "./DesktopWindowCatalog";
import { makeDesktopGameHosts } from "./DesktopGameHost";
import {
  makeDesktopWindowResources,
  type WindowBootstrap,
} from "./DesktopWindowResources";
import {
  awaitWindowCreation,
  makeDesktopWindowSessions,
  type DesktopWindowSession,
} from "./DesktopWindowSession";
import { formatGameWindowTitle } from "./GameWindowTitle";
import { DesktopWindowError } from "./DesktopWindowError";

export { DesktopWindowError } from "./DesktopWindowError";

export type DesktopWindowInstanceId = string;

export interface DesktopWindowsShape {
  readonly closeRenderer: (
    rendererId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly getRendererIds: (
    kind: DesktopWindowKind,
  ) => Effect.Effect<readonly number[]>;
  readonly getRendererId: (
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getNativeWindowId: (
    rendererId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getRendererKind: (
    rendererId: number,
  ) => Effect.Effect<DesktopRendererKind | null, DesktopWindowError>;
  readonly getOwnedRendererIds: (
    ownerRendererId: number,
    kind?: DesktopWindowKind,
  ) => Effect.Effect<readonly number[], DesktopWindowError>;
  readonly getOwnerRendererId: (
    rendererId: number,
  ) => Effect.Effect<number | null, DesktopWindowError>;
  readonly getRendererGeneration: (
    rendererId: number,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly isRendererReady: (
    rendererId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly markRendererReady: (
    rendererId: number,
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
  ) => Effect.Effect<DesktopWindowInstanceId, DesktopWindowError>;
  readonly reveal: (
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly revealRenderer: (
    rendererId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly retireManagedGameProfile: (
    key: string,
  ) => Effect.Effect<void, DesktopWindowError>;
  readonly reorderGameViews: (
    hostRendererId: number,
    ids: readonly DesktopWindowInstanceId[],
  ) => Effect.Effect<GameViewHostState, DesktopWindowError>;
  /** Reloads the tab strip and selected client when they form one focused view. */
  readonly reloadFocusedGameContents: (
    nativeWindowId: number,
    focusedRendererId: number,
    bypassCache: boolean,
  ) => Effect.Effect<boolean, DesktopWindowError>;
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

export interface DesktopWindowClosedEvent {
  readonly rendererId: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowCreatedEvent {
  readonly rendererId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererDestroyedEvent {
  readonly rendererId: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererUnavailableFailure {
  readonly reason: RenderProcessGoneDetails["reason"];
  readonly type: "render-process-gone";
}

export interface DesktopWindowRendererUnavailableEvent {
  readonly failure: DesktopWindowRendererUnavailableFailure;
  readonly rendererId: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererReloadedEvent {
  readonly rendererId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererReadyEvent {
  readonly rendererId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

const makeInstanceId = (kind: DesktopWindowKind): string =>
  `${kind}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;

const attempt = <A>(id: string | number, detail: string, body: () => A) =>
  Effect.try({
    try: body,
    catch: (cause) =>
      cause instanceof DesktopWindowError
        ? cause
        : new DesktopWindowError({ id: String(id), detail, cause }),
  });

const windowOperation = <A, E, R>(
  id: string | number,
  detail: string,
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
      const error = Cause.squash(cause);
      return Effect.fail(
        error instanceof DesktopWindowError
          ? error
          : new DesktopWindowError({ id: String(id), detail, cause: error }),
      );
    }),
  );

const standalonePresentation = (
  window: ElectronNativeWindowHandle,
): GameViewPresentation => ({
  active: true,
  layout: "focused",
  tiled: false,
  windowActive: window.isFocused(),
});

export const makeDesktopWindows = Effect.gen(function* () {
  const app = yield* ElectronApp;
  const env = yield* DesktopEnvironment;
  const settings = yield* DesktopSettings;
  const resources = yield* makeDesktopWindowResources;
  const sessions = yield* makeDesktopWindowSessions;
  const run = yield* FiberSet.makeRuntime<never, void>();
  const branding = env.isDev ? appBranding.dev : appBranding.production;
  const initialSettings = yield* resources.readSettings;
  let showUsername = initialSettings.preferences.showGameUsernameInWindowTitle;
  let quitting = false;
  let quitRequested = false;
  let hasOpened = false;
  let opening = 0;
  const hidden = new Set<string>();
  const hasPresentableWindow = () =>
    [...sessions.values()].some(
      (session) =>
        getDesktopWindowDefinition(session.kind).scope !== "game-child" &&
        !hidden.has(session.id) &&
        isElectronWindowUsable(session.window),
    );
  const quitIfNoWindow = () => {
    if (
      env.platform === "darwin" ||
      quitting ||
      quitRequested ||
      opening > 0 ||
      hasPresentableWindow()
    )
      return;
    quitRequested = true;
    run(
      app.quit.pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            quitRequested = false;
          }),
        ),
      ),
    );
  };
  const setTitle = (
    window: ElectronNativeWindowHandle,
    username: string | undefined,
  ) => {
    if (!isElectronWindowUsable(window)) return;
    try {
      window.setTitle(
        formatGameWindowTitle(branding.displayName, showUsername, username),
      );
    } catch {}
  };
  const hosts = yield* makeDesktopGameHosts(resources, sessions, {
    platform: env.platform,
    onStateChanged: ({ window, username }) => setTitle(window, username),
    onClosed: quitIfNoWindow,
  });
  yield* Effect.acquireRelease(
    app.on("before-quit", () => {
      quitting = true;
    }),
    (stop) => Effect.sync(stop),
  );
  yield* Effect.acquireRelease(
    settings.onChanged((next) => {
      const value = next.preferences.showGameUsernameInWindowTitle;
      if (showUsername === value) return;
      showUsername = value;
      hosts.refreshTitles();
      for (const session of sessions.values()) {
        if (session.kind === "game" && !hosts.ownsRenderer(session.rendererId))
          setTitle(session.window, session.username);
      }
    }),
    (stop) => Effect.sync(stop),
  );

  const requireSession = (rendererId: number): DesktopWindowSession => {
    const session = sessions.find(rendererId);
    if (session === undefined)
      throw new Error(`Desktop renderer is not open: ${rendererId}`);
    return session;
  };
  const revealSession = Effect.fn("DesktopWindows.revealSession")(function* (
    session: DesktopWindowSession,
  ) {
    if (hosts.ownsRenderer(session.rendererId)) {
      if (hosts.hostId(session.rendererId) === undefined) return false;
      hosts.reveal(session.rendererId);
    }
    yield* resources.reveal(session.window);
    hidden.delete(session.id);
    return true;
  });
  const reveal: DesktopWindowsShape["reveal"] = (id) =>
    windowOperation(
      id,
      "Failed to reveal desktop window.",
      Effect.suspend(() => {
        const session = sessions.get(id);
        return session === undefined
          ? Effect.succeed(false)
          : revealSession(session);
      }),
    );
  const revealRenderer: DesktopWindowsShape["revealRenderer"] = (rendererId) =>
    windowOperation(
      rendererId,
      "Failed to reveal desktop renderer.",
      Effect.suspend(() => {
        const session = sessions.find(rendererId);
        return session === undefined
          ? Effect.succeed(false)
          : revealSession(session);
      }),
    );

  const openBrowser = Effect.fn("DesktopWindows.openBrowser")(function* (
    id: string,
    kind: DesktopWindowKind,
    ownerId: string | undefined,
    input: WindowBootstrap,
    options?: DesktopWindowOpenOptions,
  ) {
    const definition = getDesktopWindowDefinition(kind);
    let publishedUsername: string | undefined;
    const owner = ownerId === undefined ? undefined : sessions.get(ownerId);
    if (ownerId !== undefined && owner === undefined)
      return yield* Effect.fail(
        new DesktopWindowError({
          id,
          detail: "The owning game closed during creation.",
        }),
      );
    const session = yield* sessions.open({
      id,
      kind,
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(owner === undefined ? {} : { parentScope: owner.scope }),
      acquire: resources
        .browser(kind, input, options)
        .pipe(
          Effect.map((window) => ({ window, contents: window.webContents })),
        ),
      setup: (session) =>
        Effect.gen(function* () {
          const window = session.window;
          yield* observeElectronEvent(window, "closed", () => {
            run(session.close);
          });
          if (definition.closeBehavior === "hide")
            yield* observeElectronEvent(
              window,
              "close",
              (event: { preventDefault: () => void }) => {
                if (quitting || window.isDestroyed()) return;
                event.preventDefault();
                window.hide();
                if (definition.scope !== "game-child") {
                  hidden.add(id);
                  quitIfNoWindow();
                }
              },
            );
          if (kind === "game") {
            let lastActive: boolean | undefined;
            const publishPresentation = (_event: ElectronEvent) => {
              if (session.contents.isDestroyed()) return;
              const next = standalonePresentation(window);
              if (next.windowActive === lastActive) return;
              lastActive = next.windowActive;
              session.contents.send(
                GameViewsIpc.presentationChanged.channel,
                next,
              );
            };
            yield* observeElectronEvent(
              window,
              "page-title-updated",
              (event: ElectronEvent, _title: string, _explicitSet: boolean) => {
                event.preventDefault();
                setTitle(window, session.username);
              },
            );
            yield* observeElectronEvent(window, "focus", publishPresentation);
            yield* observeElectronEvent(window, "blur", publishPresentation);
            setTitle(window, session.username);
          }
        }),
      onChanged: (session) => {
        if (kind === "game" && session.username !== publishedUsername) {
          publishedUsername = session.username;
          setTitle(session.window, session.username);
        }
      },
      onClosed: () => {
        hidden.delete(id);
        if (definition.scope !== "game-child") quitIfNoWindow();
      },
      ...(options?.onCreated === undefined
        ? {}
        : { onCreated: options.onCreated }),
    });
    return yield* Effect.gen(function* () {
      yield* resources.loadBrowser(session.window, kind);
      yield* resources.reveal(session.window);
      return session;
    }).pipe(
      Effect.forkIn(session.scope, { startImmediately: true }),
      Effect.flatMap((fiber) => awaitWindowCreation(id, fiber)),
      Effect.onError(() => session.close),
    );
  });

  const open: DesktopWindowsShape["open"] = (kind, options) =>
    windowOperation(
      kind,
      `Failed to open desktop window: ${kind}`,
      Effect.gen(function* () {
        const definition = getDesktopWindowDefinition(kind);
        const ownerId = yield* attempt(
          kind,
          `Invalid logical owner for desktop window: ${kind}`,
          () => {
            if (definition.scope !== "game-child") {
              if (options?.ownerRendererId !== undefined)
                throw new Error(
                  `${kind} does not accept a logical owner window.`,
                );
              return undefined;
            }
            if (options?.ownerRendererId === undefined)
              throw new Error(`${kind} requires an owning game window.`);
            const owner = requireSession(options.ownerRendererId);
            if (owner.kind !== "game" || owner.ownerId !== undefined)
              throw new Error("The owning window must be an open root game.");
            return owner.id;
          },
        );
        if (definition.singleInstance) {
          const existing = [...sessions.values()].find(
            (session) =>
              session.kind === kind &&
              session.ownerId === ownerId &&
              sessions.get(session.id) !== undefined,
          );
          if (existing !== undefined) {
            yield* revealSession(existing);
            return existing.id;
          }
        }
        const topLevel = definition.scope !== "game-child";
        if (topLevel) opening++;
        return yield* Effect.gen(function* () {
          const id = makeInstanceId(kind);
          const input = yield* resources.bootstrap;
          if (kind === "game") yield* resources.prepareGameNetworking;
          if (kind === "game" && input.settings.preferences.useGameTabs) {
            const target = options?.gameHostTarget;
            const hostId =
              target?.kind === "available"
                ? hosts.available()
                : target?.kind === "game-view"
                  ? hosts.hostId(target.rendererId)
                  : undefined;
            if (target?.kind === "game-view" && hostId === undefined)
              return yield* Effect.fail(
                new DesktopWindowError({
                  id,
                  detail: "The target game window is not open.",
                }),
              );
            const session =
              hostId === undefined
                ? yield* hosts.create(id, input, options)
                : yield* hosts.add(hostId, id, input, options);
            if (hostId !== undefined)
              yield* resources
                .reveal(session.window)
                .pipe(Effect.onError(() => session.close));
          } else {
            yield* openBrowser(id, kind, ownerId, input, options);
          }
          if (topLevel) hasOpened = true;
          yield* Effect.logInfo("Desktop window opened").pipe(
            Effect.annotateLogs({ component: "window", data: { id, kind } }),
          );
          return id;
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (topLevel) {
                opening--;
                quitIfNoWindow();
              }
            }),
          ),
        );
      }),
    );

  if (env.platform === "darwin")
    yield* Effect.acquireRelease(
      app.on("activate", () => {
        run(
          Effect.gen(function* () {
            if (quitting || !hasOpened || opening > 0 || hasPresentableWindow())
              return;
            const manager = [...sessions.values()].find(
              (session) =>
                session.kind === "account-manager" &&
                sessions.get(session.id) !== undefined,
            );
            if (manager !== undefined) {
              yield* revealSession(manager);
              return;
            }
            const current = yield* resources.readSettings;
            yield* open(
              current.preferences.launchMode === "account-manager"
                ? "account-manager"
                : "game",
            );
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to restore a primary window", cause),
            ),
          ),
        );
      }),
      (stop) => Effect.sync(stop),
    );

  return DesktopWindows.of({
    open,
    reveal,
    revealRenderer,
    closeRenderer: (rendererId) =>
      windowOperation(
        rendererId,
        "Failed to close desktop renderer.",
        Effect.suspend(() => {
          const session = sessions.find(rendererId);
          if (session === undefined) return Effect.succeed(false);
          return (
            hosts.ownsRenderer(rendererId)
              ? session.close
              : Effect.sync(() => session.window.close())
          ).pipe(Effect.as(true));
        }),
      ),
    getRendererIds: (kind) =>
      Effect.sync(() =>
        [...sessions.values()]
          .filter(
            (session) =>
              session.kind === kind && sessions.get(session.id) !== undefined,
          )
          .map((session) => session.rendererId),
      ),
    getRendererId: (id) =>
      attempt(id, "Failed to resolve renderer.", () => {
        const session = sessions.get(id);
        if (session === undefined)
          throw new Error(`Desktop window is not open: ${id}`);
        return session.rendererId;
      }),
    getNativeWindowId: (rendererId) =>
      attempt(
        rendererId,
        "Failed to resolve native window.",
        () =>
          (hosts.nativeWindow(rendererId) ?? requireSession(rendererId).window)
            .id,
      ),
    getRendererKind: (rendererId) =>
      Effect.sync(
        () =>
          sessions.find(rendererId)?.kind ??
          hosts.rendererKind(rendererId) ??
          null,
      ),
    getOwnerRendererId: (rendererId) =>
      Effect.sync(() => {
        const ownerId = sessions.find(rendererId)?.ownerId;
        return ownerId === undefined
          ? null
          : (sessions.get(ownerId)?.rendererId ?? null);
      }),
    getOwnedRendererIds: (rendererId, kind) =>
      attempt(rendererId, "Failed to resolve owned windows.", () => {
        const owner = requireSession(rendererId);
        return [...sessions.values()]
          .filter(
            (session) =>
              session.ownerId === owner.id &&
              (kind === undefined || session.kind === kind) &&
              sessions.get(session.id) !== undefined,
          )
          .map((session) => session.rendererId);
      }),
    getRendererGeneration: (rendererId) =>
      attempt(
        rendererId,
        "Failed to read renderer generation.",
        () => requireSession(rendererId).state.generation,
      ),
    isRendererReady: (rendererId) =>
      Effect.sync(() => sessions.find(rendererId)?.state.phase === "ready"),
    markRendererReady: (rendererId, generation) =>
      windowOperation(
        rendererId,
        "Failed to mark renderer ready.",
        Effect.suspend(() => requireSession(rendererId).markReady(generation)),
      ),
    onCreated: sessions.created.subscribe,
    onClosed: sessions.closed.subscribe,
    onRendererDestroyed: sessions.destroyed.subscribe,
    onRendererUnavailable: sessions.unavailable.subscribe,
    onRendererReloaded: sessions.reloaded.subscribe,
    onRendererReady: sessions.ready.subscribe,
    addGameView: (hostId) =>
      windowOperation(
        hostId,
        "Failed to add a game view.",
        Effect.gen(function* () {
          const input = yield* resources.bootstrap;
          yield* resources.prepareGameNetworking;
          yield* hosts.add(hostId, makeInstanceId("game"), input);
          return hosts.state(hostId);
        }),
      ),
    closeGameView: (hostId, id) =>
      windowOperation(
        id,
        "Failed to close game view.",
        hosts.closeView(hostId, id),
      ),
    getGameViewHostState: (hostId) =>
      attempt(hostId, "Failed to read game window state.", () =>
        hosts.state(hostId),
      ),
    getGameViewHostRendererId: (rendererId) =>
      attempt(rendererId, "Failed to resolve game view host.", () => {
        requireSession(rendererId);
        const hostId = hosts.hostId(rendererId);
        if (hostId === undefined)
          throw new Error("Game view host is not open.");
        return hostId;
      }),
    selectGameView: (hostId, id, focus) =>
      attempt(id, "Failed to select game view.", () =>
        hosts.select(hostId, id, focus),
      ),
    reorderGameViews: (hostId, ids) =>
      attempt(hostId, "Failed to reorder game views.", () =>
        hosts.reorder(hostId, ids),
      ),
    setGameViewLayout: (hostId, layout) =>
      attempt(hostId, "Failed to change game view layout.", () =>
        hosts.setLayout(hostId, layout),
      ),
    setGameViewGroupControlsOpen: (hostId, value) =>
      attempt(hostId, "Failed to update group controls.", () =>
        hosts.setGroupControlsOpen(hostId, value),
      ),
    setGameViewGroupTargets: (hostId, ids) =>
      attempt(hostId, "Failed to set group targets.", () =>
        hosts.setGroupTargets(hostId, ids),
      ),
    setGameViewTabMenuOpen: (hostId, value) =>
      attempt(hostId, "Failed to update the tab menu.", () =>
        hosts.setTabMenuOpen(hostId, value),
      ),
    syncGameViewTabBarLayout: (hostId) =>
      attempt(hostId, "Failed to synchronize the tab bar.", () =>
        hosts.syncTabBarLayout(hostId),
      ),
    getGameViewPresentation: (rendererId) =>
      attempt(rendererId, "Failed to resolve game view presentation.", () => {
        const session = requireSession(rendererId);
        if (session.kind !== "game") throw new Error("Renderer is not a game.");
        return !hosts.ownsRenderer(rendererId)
          ? standalonePresentation(session.window)
          : hosts.presentation(rendererId);
      }),
    setGameViewName: (rendererId, name) =>
      attempt(rendererId, "Failed to update game view name.", () => {
        const session = requireSession(rendererId);
        if (session.kind !== "game") throw new Error("Renderer is not a game.");
        session.setName(name);
      }),
    reloadFocusedGameContents: (windowId, rendererId, bypassCache) =>
      attempt(windowId, "Failed to reload the focused game view.", () =>
        hosts.reloadFocused(windowId, rendererId, bypassCache),
      ),
    withGameViewGroupControlsNativeDialog: (hostId, use) =>
      Effect.acquireUseRelease(
        attempt(hostId, "Failed to resolve game view host.", () =>
          hosts.nativeDialog(hostId),
        ),
        ({ windowId }) => use(windowId),
        ({ restore }) => Effect.sync(restore),
      ),
    setBackgroundColor: (color) =>
      Effect.forEach(
        sessions.values(),
        (session) =>
          Effect.try(() => {
            if (isElectronWindowUsable(session.window)) {
              session.window.setBackgroundColor(color);
              hosts.setViewBackgroundColor(session, color);
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to update window background", cause),
            ),
          ),
        { discard: true },
      ),
    retireManagedGameProfile: (key) =>
      windowOperation(
        "game-profile",
        "Failed to retire managed game profile.",
        resources.retireManagedGameProfile(key),
      ),
  });
});

export const layer = Layer.effect(DesktopWindows, makeDesktopWindows);
