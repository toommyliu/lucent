import {
  BrowserWindow,
  type BrowserView,
  screen,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export {
  isElectronWindowUsable,
  type ElectronWindowUsabilityTarget,
} from "./windowUsability";
import { isElectronWindowUsable } from "./windowUsability";

export interface ElectronWindowWebContents {
  readonly focus: WebContents["focus"];
  readonly id: number;
  readonly invalidate: WebContents["invalidate"];
  readonly isDestroyed: () => boolean;
  readonly off: WebContents["removeListener"];
  readonly on: WebContents["on"];
  readonly openDevTools: (options?: { readonly mode?: string }) => void;
  readonly send: WebContents["send"];
  readonly setWindowOpenHandler?: (
    handler: (details: { readonly url: string }) => { readonly action: "deny" },
  ) => void;
}

export interface ElectronWindowHandle {
  readonly id: number;
  readonly webContents: ElectronWindowWebContents;
  readonly addBrowserView: (browserView: BrowserView) => void;
  readonly close: () => void;
  readonly destroy: () => void;
  readonly focus: () => void;
  readonly hide: () => void;
  readonly isDestroyed: () => boolean;
  readonly isFocused: () => boolean;
  readonly isMinimized: () => boolean;
  readonly isVisible: () => boolean;
  readonly getContentBounds: BrowserWindow["getContentBounds"];
  readonly loadFile: (path: string) => Promise<void>;
  readonly on: BrowserWindow["on"];
  readonly once: BrowserWindow["once"];
  readonly restore: () => void;
  readonly removeBrowserView: (browserView: BrowserView) => void;
  readonly setBackgroundColor: (backgroundColor: string) => void;
  readonly setMenuBarVisibility: (visible: boolean) => void;
  readonly setTitle: (title: string) => void;
  readonly setTopBrowserView: (browserView: BrowserView) => void;
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

export type ElectronWindowCreateOptions = BrowserWindowConstructorOptions & {
  readonly height: number;
  readonly width: number;
};

export type ElectronWindowOpenRequestHandler = (url: string) => void;

export interface ElectronWindowShape {
  readonly create: (
    options: ElectronWindowCreateOptions,
    onWindowOpenRequest?: ElectronWindowOpenRequestHandler,
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

const denyRendererWindowOpen = (
  window: ElectronWindowHandle,
  onWindowOpenRequest?: ElectronWindowOpenRequestHandler,
): void => {
  if (window.webContents.setWindowOpenHandler !== undefined) {
    window.webContents.setWindowOpenHandler(({ url }) => {
      onWindowOpenRequest?.(url);
      return { action: "deny" };
    });
    return;
  }

  window.webContents.on("new-window", (event, url) => {
    event.preventDefault();
    onWindowOpenRequest?.(url);
  });
};

const makeCenteredOptions = (
  options: ElectronWindowCreateOptions,
): ElectronWindowCreateOptions => {
  if (options.x !== undefined && options.y !== undefined) {
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

const create: ElectronWindowShape["create"] = (options, onWindowOpenRequest) =>
  Effect.try({
    try: () => {
      const window = new BrowserWindow({
        ...makeCenteredOptions(options),
      }) as unknown as ElectronWindowHandle;
      denyRendererWindowOpen(window, onWindowOpenRequest);
      return window;
    },
    catch: (cause) => new ElectronWindowCreateError({ cause }),
  });

const loadFile: ElectronWindowShape["loadFile"] = (window, path) =>
  Effect.tryPromise({
    try: () => window.loadFile(path),
    catch: (cause) => new ElectronWindowLoadError({ cause, path }),
  });

const reveal: ElectronWindowShape["reveal"] = (window) =>
  Effect.sync(() => {
    if (!isElectronWindowUsable(window)) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    if (!window.isVisible()) {
      window.show();
    }

    window.focus();
  });

export const layer = Layer.succeed(
  ElectronWindow,
  ElectronWindow.of({
    create,
    loadFile,
    reveal,
  }),
);
