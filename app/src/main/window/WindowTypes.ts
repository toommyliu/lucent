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

export class WindowManagerError extends Data.TaggedError("WindowManagerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface WindowManagerConfig {
  readonly appIconPath: string;
  readonly gameWindowHtmlPath: string;
  readonly isDev: boolean;
  readonly platform: NodeJS.Platform;
  readonly preloadPath: string;
  readonly windowHtmlPath: (id: WindowId) => string;
  readonly getSettingsSnapshot: () => AppSettings;
  readonly getAppearanceSnapshot: (settings: AppSettings) => AppearanceSnapshot;
  readonly quitApp: () => void;
  readonly onWindowCreated?: (
    window: BrowserWindow,
    context: WindowStartupContext,
  ) => void;
  readonly onGameWindowCreated?: (window: BrowserWindow) => void;
}

export type WindowStartupContext = PreloadWindowContext;

export interface WindowServiceShape {
  readonly openGameWindow: (options?: {
    readonly bounds?: Rectangle;
  }) => Effect.Effect<BrowserWindow, WindowManagerError>;
  readonly openWindow: (
    id: WindowId,
    senderWindowId?: number,
  ) => Effect.Effect<BrowserWindow, WindowManagerError>;
  readonly getOpenWindow: (id: WindowId) => Effect.Effect<BrowserWindow | null>;
  readonly getCursorDisplayWorkArea: () => Effect.Effect<
    Rectangle,
    WindowManagerError
  >;
  readonly revealGameWindow: () => Effect.Effect<void, WindowManagerError>;
  readonly revealWindowForAppActivation: () => Effect.Effect<
    void,
    WindowManagerError
  >;
  readonly getGameWindowId: (
    windowId: number,
  ) => Effect.Effect<number | undefined>;
  readonly getGameWindowIds: () => Effect.Effect<readonly number[]>;
  readonly getGameChildWindow: (
    gameWindowId: number,
    id: WindowId,
  ) => Effect.Effect<BrowserWindow | null>;
  readonly getGameWindow: (
    gameWindowId: number,
  ) => Effect.Effect<BrowserWindow | null>;
  readonly getWindowContext: (
    windowId: number,
  ) => Effect.Effect<WindowStartupContext | undefined>;
  readonly requestCloseGameWindow: (
    gameWindowId: number,
  ) => Effect.Effect<void>;
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
