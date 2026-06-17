import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Rectangle,
} from "electron";
import { Data, Effect, ServiceMap } from "effect";
import type { AppearanceSnapshot } from "../../shared/appearance-snapshot";
import type { AppSettings } from "../../shared/settings";
import type { PreloadWindowContext } from "../../shared/window-startup-context";
import type { WindowId } from "../../shared/windows";

export interface GameWindowRef {
  readonly kind: "game";
  readonly id: number;
}

export interface AppWindowRef {
  readonly kind: "app";
  readonly id: WindowId;
  readonly windowId: number;
}

export interface GameChildWindowRef {
  readonly kind: "game-child";
  readonly id: WindowId;
  readonly gameWindowId: number;
  readonly windowId: number;
}

export type ManagedWindowRef =
  | AppWindowRef
  | GameChildWindowRef
  | GameWindowRef;

export type CatalogWindowRef = AppWindowRef | GameChildWindowRef;

export const makeGameWindowRef = (id: number): GameWindowRef => ({
  kind: "game",
  id,
});

export const makeAppWindowRef = (
  id: WindowId,
  windowId: number,
): AppWindowRef => ({
  kind: "app",
  id,
  windowId,
});

export const makeGameChildWindowRef = (
  gameWindowId: number,
  id: WindowId,
  windowId: number,
): GameChildWindowRef => ({
  kind: "game-child",
  gameWindowId,
  id,
  windowId,
});

export const getWindowRefId = (ref: ManagedWindowRef): number =>
  ref.kind === "game" ? ref.id : ref.windowId;

export class UnknownWindowDefinitionError extends Data.TaggedError(
  "UnknownWindowDefinitionError",
)<{
  readonly id: unknown;
  readonly message: string;
}> {}

export class UnsupportedWindowDefinitionError extends Data.TaggedError(
  "UnsupportedWindowDefinitionError",
)<{
  readonly id: WindowId;
  readonly scope: string;
  readonly message: string;
}> {}

export class WindowCreateError extends Data.TaggedError("WindowCreateError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class WindowLoadError extends Data.TaggedError("WindowLoadError")<{
  readonly message: string;
  readonly target: string;
  readonly kind: "file" | "url";
  readonly cause: unknown;
}> {}

export class StaleWindowRefError extends Data.TaggedError(
  "StaleWindowRefError",
)<{
  readonly ref: ManagedWindowRef | GameWindowRef;
  readonly message: string;
}> {}

export class MissingParentGameWindowError extends Data.TaggedError(
  "MissingParentGameWindowError",
)<{
  readonly gameWindowId?: number;
  readonly message: string;
}> {}

export class WindowSenderAuthorizationError extends Data.TaggedError(
  "WindowSenderAuthorizationError",
)<{
  readonly message: string;
}> {}

export class WindowOperationError extends Data.TaggedError(
  "WindowOperationError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type WindowManagerError =
  | MissingParentGameWindowError
  | StaleWindowRefError
  | UnknownWindowDefinitionError
  | UnsupportedWindowDefinitionError
  | WindowCreateError
  | WindowLoadError
  | WindowOperationError
  | WindowSenderAuthorizationError;

export interface WindowEnvironment {
  readonly appIconPath: string;
  readonly gameWindowHtmlPath: string;
  readonly isDev: boolean;
  readonly platform: NodeJS.Platform;
  readonly preloadPath: string;
  readonly windowHtmlPath: (id: WindowId) => string;
}

export class WindowEnvironmentService extends ServiceMap.Service<
  WindowEnvironmentService,
  WindowEnvironment
>()("main/window/WindowEnvironment") {}

export interface WindowSnapshotServiceShape {
  readonly getSettingsSnapshot: Effect.Effect<AppSettings, WindowManagerError>;
  readonly getAppearanceSnapshot: (
    settings: AppSettings,
  ) => Effect.Effect<AppearanceSnapshot, WindowManagerError>;
}

export class WindowSnapshotService extends ServiceMap.Service<
  WindowSnapshotService,
  WindowSnapshotServiceShape
>()("main/window/WindowSnapshotService") {}

export interface WindowLifecycleHooksShape {
  readonly quitApp: Effect.Effect<void>;
  readonly onWindowCreated: (
    ref: ManagedWindowRef,
    window: BrowserWindow,
    context: WindowStartupContext,
  ) => Effect.Effect<void>;
  readonly onGameWindowCreated: (
    ref: GameWindowRef,
    window: BrowserWindow,
  ) => Effect.Effect<void>;
}

export class WindowLifecycleHooks extends ServiceMap.Service<
  WindowLifecycleHooks,
  WindowLifecycleHooksShape
>()("main/window/WindowLifecycleHooks") {}

export type WindowStartupContext = PreloadWindowContext;

export interface WindowServiceShape {
  readonly openGameWindow: (options?: {
    readonly bounds?: Rectangle;
  }) => Effect.Effect<GameWindowRef, WindowManagerError>;
  readonly openWindow: (
    id: WindowId,
    senderWindowId?: number,
  ) => Effect.Effect<CatalogWindowRef, WindowManagerError>;
  readonly getOpenWindow: (
    id: WindowId,
  ) => Effect.Effect<CatalogWindowRef | null>;
  readonly getCursorDisplayWorkArea: () => Effect.Effect<
    Rectangle,
    WindowManagerError
  >;
  readonly revealGameWindow: () => Effect.Effect<void, WindowManagerError>;
  readonly revealWindow: (
    ref: ManagedWindowRef,
  ) => Effect.Effect<void, WindowManagerError>;
  readonly revealWindowForAppActivation: () => Effect.Effect<
    void,
    WindowManagerError
  >;
  readonly getGameWindowRef: (
    windowId: number,
  ) => Effect.Effect<GameWindowRef | undefined>;
  readonly getGameWindowRefById: (
    gameWindowId: number,
  ) => Effect.Effect<GameWindowRef | null>;
  readonly getGameWindowRefs: () => Effect.Effect<readonly GameWindowRef[]>;
  readonly getGameChildWindowRef: (
    gameWindowId: number,
    id: WindowId,
  ) => Effect.Effect<GameChildWindowRef | null>;
  readonly getWindowContext: (
    windowId: number,
  ) => Effect.Effect<WindowStartupContext | undefined>;
  readonly sendToWindow: (
    ref: ManagedWindowRef,
    channel: string,
    ...args: readonly unknown[]
  ) => Effect.Effect<boolean, WindowManagerError>;
  readonly onWindowClosed: (
    ref: ManagedWindowRef,
    listener: () => void,
  ) => Effect.Effect<() => void, WindowManagerError>;
  readonly requestCloseGameWindow: (
    ref: GameWindowRef,
  ) => Effect.Effect<void, WindowManagerError>;
  readonly setQuitting: (quitting: boolean) => Effect.Effect<void>;
}

export class WindowService extends ServiceMap.Service<
  WindowService,
  WindowServiceShape
>()("main/WindowService") {}

export type WindowEffectRunner = <A>(
  effect: Effect.Effect<A, WindowManagerError, WindowService>,
) => Promise<A>;

export interface ElectronWindowRuntime {
  readonly platform: NodeJS.Platform;
  readonly createWindow: (
    options: BrowserWindowConstructorOptions,
  ) => BrowserWindow;
  readonly fromId: (id: number) => BrowserWindow | null;
  readonly getAllWindows: () => BrowserWindow[];
  readonly getFocusedWindow: () => BrowserWindow | null;
  readonly getCenteredPosition: (
    width: number,
    height: number,
  ) => { readonly x: number; readonly y: number };
  readonly getCursorDisplayWorkArea: () => Rectangle;
  readonly focusApp: () => void;
}
