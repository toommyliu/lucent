import {
  BrowserWindow,
  BaseWindow,
  type BaseWindowConstructorOptions,
  type LoadFileOptions,
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
import { electronRendererRegistry } from "./ElectronRendererRegistry";
import { resolvePlacementWorkArea } from "./windowPlacement";

export interface ElectronWindowWebContents {
  readonly focus: WebContents["focus"];
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly off: WebContents["removeListener"];
  readonly on: WebContents["on"];
  readonly openDevTools: WebContents["openDevTools"];
  readonly send: WebContents["send"];
}

export interface ElectronNativeWindowHandle {
  readonly id: number;
  readonly contentView: BaseWindow["contentView"];
  readonly close: () => void;
  readonly destroy: () => void;
  readonly focus: () => void;
  readonly hide: () => void;
  readonly isDestroyed: () => boolean;
  readonly isFocused: () => boolean;
  readonly isMinimized: () => boolean;
  readonly isVisible: () => boolean;
  readonly getContentBounds: BrowserWindow["getContentBounds"];
  readonly on: BaseWindow["on"];
  readonly once: BaseWindow["once"];
  readonly restore: () => void;
  readonly setBackgroundColor: (backgroundColor: string) => void;
  readonly setMenuBarVisibility: (visible: boolean) => void;
  readonly setTitle: (title: string) => void;
  readonly show: () => void;
}

export interface ElectronWindowHandle extends ElectronNativeWindowHandle {
  readonly webContents: ElectronWindowWebContents;
  readonly loadFile: BrowserWindow["loadFile"];
  readonly on: BrowserWindow["on"];
  readonly once: BrowserWindow["once"];
}

export type ElectronHostWindowCreateOptions = BaseWindowConstructorOptions & {
  readonly height: number;
  readonly width: number;
};

export class ElectronWindowCreateError extends Schema.TaggedError<ElectronWindowCreateError>()(
  "ElectronWindowCreateError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create Electron window.";
  }
}

export class ElectronWindowLoadError extends Schema.TaggedError<ElectronWindowLoadError>()(
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
  readonly createHost: (
    options: ElectronHostWindowCreateOptions,
  ) => Effect.Effect<ElectronNativeWindowHandle, ElectronWindowCreateError>;
  readonly create: (
    options: ElectronWindowCreateOptions,
    onWindowOpenRequest?: ElectronWindowOpenRequestHandler,
  ) => Effect.Effect<ElectronWindowHandle, ElectronWindowCreateError>;
  readonly loadFile: (
    window: ElectronWindowHandle,
    path: string,
    options?: LoadFileOptions,
  ) => Effect.Effect<void, ElectronWindowLoadError>;
  readonly reveal: (window: ElectronNativeWindowHandle) => Effect.Effect<void>;
}

export class ElectronWindow extends Context.Service<
  ElectronWindow,
  ElectronWindowShape
>()("lucent/desktop/electron/ElectronWindow") {}

/** Keeps a renderer on its document; blocked URLs go to the open-request handler. */
export const guardRendererNavigation = (
  webContents: Pick<WebContents, "getURL" | "on" | "setWindowOpenHandler">,
  onWindowOpenRequest?: ElectronWindowOpenRequestHandler,
): void => {
  webContents.setWindowOpenHandler(({ url }) => {
    onWindowOpenRequest?.(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event) => {
    // Renderer-initiated reloads arrive here with the current URL.
    if (event.url === webContents.getURL()) {
      return;
    }

    event.preventDefault();
    onWindowOpenRequest?.(event.url);
  });
};

const makeCenteredOptions = <Options extends ElectronHostWindowCreateOptions>(
  options: Options,
): Options => {
  if (options.x !== undefined && options.y !== undefined) {
    return options;
  }

  const bounds = resolvePlacementWorkArea();
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
      });
      electronRendererRegistry.register(window.webContents);
      guardRendererNavigation(window.webContents, onWindowOpenRequest);
      return window;
    },
    catch: (cause) => new ElectronWindowCreateError({ cause }),
  });

const createHost: ElectronWindowShape["createHost"] = (options) =>
  Effect.try({
    try: () => new BaseWindow(makeCenteredOptions(options)),
    catch: (cause) => new ElectronWindowCreateError({ cause }),
  });

const loadFile: ElectronWindowShape["loadFile"] = (window, path, options) =>
  Effect.tryPromise({
    try: () => window.loadFile(path, options),
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
    createHost,
    loadFile,
    reveal,
  }),
);
