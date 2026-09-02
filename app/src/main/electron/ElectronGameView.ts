import {
  BrowserView,
  type BrowserViewConstructorOptions,
  type LoadFileOptions,
  type WebContents,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { ElectronWindowOpenRequestHandler } from "./ElectronWindow";

export type ElectronGameViewHandle = BrowserView;

export class ElectronGameViewCreateError extends Schema.TaggedError<ElectronGameViewCreateError>()(
  "ElectronGameViewCreateError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to create Electron game view.";
  }
}

export class ElectronGameViewLoadError extends Schema.TaggedError<ElectronGameViewLoadError>()(
  "ElectronGameViewLoadError",
  {
    cause: Schema.Defect(),
    path: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to load Electron game view file: ${this.path}.`;
  }
}

export interface ElectronGameViewShape {
  readonly create: (
    options: BrowserViewConstructorOptions,
    onWindowOpenRequest?: ElectronWindowOpenRequestHandler,
  ) => Effect.Effect<ElectronGameViewHandle, ElectronGameViewCreateError>;
  readonly loadFile: (
    view: ElectronGameViewHandle,
    path: string,
    options?: LoadFileOptions,
  ) => Effect.Effect<void, ElectronGameViewLoadError>;
  readonly onFocus: (
    view: ElectronGameViewHandle,
    listener: () => void,
  ) => () => void;
  readonly destroy: (view: ElectronGameViewHandle) => void;
}

export class ElectronGameView extends Context.Service<
  ElectronGameView,
  ElectronGameViewShape
>()("lucent/desktop/electron/ElectronGameView") {}

const denyRendererWindowOpen = (
  webContents: WebContents,
  onWindowOpenRequest?: ElectronWindowOpenRequestHandler,
): void => {
  webContents.on("new-window", (event, url) => {
    event.preventDefault();
    onWindowOpenRequest?.(url);
  });
};

const create: ElectronGameViewShape["create"] = (
  options,
  onWindowOpenRequest,
) =>
  Effect.try({
    try: () => {
      const view = new BrowserView(options);
      denyRendererWindowOpen(view.webContents, onWindowOpenRequest);
      return view;
    },
    catch: (cause) => new ElectronGameViewCreateError({ cause }),
  });

const loadFile: ElectronGameViewShape["loadFile"] = (view, path, options) =>
  Effect.tryPromise({
    try: () => view.webContents.loadFile(path, options),
    catch: (cause) => new ElectronGameViewLoadError({ cause, path }),
  });

const onFocus: ElectronGameViewShape["onFocus"] = (view, listener) => {
  // Electron 11 emits this event at runtime but omits it from the public
  // WebContents overloads. Keep the compatibility cast inside this adapter.
  const webContents = view.webContents as unknown as {
    readonly isDestroyed: () => boolean;
    readonly on: (event: "focus", listener: () => void) => void;
    readonly removeListener: (event: "focus", listener: () => void) => void;
  };
  webContents.on("focus", listener);

  let observing = true;
  return () => {
    if (!observing) return;
    observing = false;
    try {
      if (!webContents.isDestroyed()) {
        webContents.removeListener("focus", listener);
      }
    } catch {}
  };
};

const destroy: ElectronGameViewShape["destroy"] = (view) => {
  if (view.webContents.isDestroyed()) {
    return;
  }

  // Electron 11 exposes this teardown hook at runtime but omits it from the
  // public WebContents type. Keep the compatibility cast inside this adapter.
  const webContents = view.webContents as WebContents & {
    readonly destroy: () => void;
  };
  try {
    webContents.destroy();
  } catch {}
};

export const layer = Layer.succeed(
  ElectronGameView,
  ElectronGameView.of({ create, destroy, loadFile, onFocus }),
);
