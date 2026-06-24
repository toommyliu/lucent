import {
  BrowserWindow,
  screen,
  type BrowserWindowConstructorOptions,
} from "electron";

import { Context, Effect, Layer, Schema } from "effect";

export interface ElectronWindowWebContents {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly on: (eventName: string, listener: (...args: any[]) => void) => void;
  readonly openDevTools: (options?: { readonly mode?: string }) => void;
  readonly setWindowOpenHandler?: (
    handler: () => { readonly action: "deny" },
  ) => void;
}

export interface ElectronWindowHandle {
  readonly id: number;
  readonly webContents: ElectronWindowWebContents;
  readonly focus: () => void;
  readonly isDestroyed: () => boolean;
  readonly isMinimized: () => boolean;
  readonly isVisible: () => boolean;
  readonly loadFile: (path: string) => Promise<void>;
  readonly once: (eventName: string, listener: () => void) => void;
  readonly restore: () => void;
  readonly setMenuBarVisibility: (visible: boolean) => void;
  readonly show: () => void;
}

export class ElectronWindowCreateError extends Schema.TaggedErrorClass<ElectronWindowCreateError>()(
  "ElectronWindowCreateError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create Electron window.";
  }
}

export class ElectronWindowLoadError extends Schema.TaggedErrorClass<ElectronWindowLoadError>()(
  "ElectronWindowLoadError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to load Electron window file: ${this.path}.`;
  }
}

export interface ElectronWindowShape {
  readonly create: (
    options: BrowserWindowConstructorOptions,
  ) => Effect.Effect<ElectronWindowHandle, ElectronWindowCreateError>;
  readonly loadFile: (
    window: ElectronWindowHandle,
    path: string,
  ) => Effect.Effect<void, ElectronWindowLoadError>;
  readonly reveal: (window: ElectronWindowHandle) => Effect.Effect<void>;
}

export class ElectronWindow extends Context.Service<
  ElectronWindow,
  ElectronWindowShape
>()("lucent/desktop/electron/ElectronWindow") {}

const denyRendererWindowOpen = (window: ElectronWindowHandle): void => {
  window.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
  window.webContents.on(
    "new-window",
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
    },
  );
};

const makeCenteredOptions = (
  options: BrowserWindowConstructorOptions,
): BrowserWindowConstructorOptions => {
  if (typeof options.width !== "number" || typeof options.height !== "number") {
    return options;
  }

  const bounds = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  return {
    ...options,
    x: Math.round(bounds.x + (bounds.width - options.width) / 2),
    y: Math.round(bounds.y + (bounds.height - options.height) / 2),
  };
};

export const layer = Layer.succeed(
  ElectronWindow,
  ElectronWindow.of({
    create: (options) =>
      Effect.try({
        try: () => {
          const window = new BrowserWindow({
            ...makeCenteredOptions(options),
          }) as unknown as ElectronWindowHandle;
          denyRendererWindowOpen(window);
          return window;
        },
        catch: (cause) => new ElectronWindowCreateError({ cause }),
      }),
    loadFile: (window, path) =>
      Effect.tryPromise({
        try: () => window.loadFile(path),
        catch: (cause) => new ElectronWindowLoadError({ cause, path }),
      }),
    reveal: (window) =>
      Effect.sync(() => {
        if (window.isDestroyed()) {
          return;
        }

        if (window.isMinimized()) {
          window.restore();
        }

        if (!window.isVisible()) {
          window.show();
        }

        window.focus();
      }),
  }),
);
