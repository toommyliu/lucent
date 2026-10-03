import {
  WebContentsView,
  type WebContentsViewConstructorOptions,
  type LoadFileOptions,
  type WebContents,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { electronRendererRegistry } from "./ElectronRendererRegistry";
import {
  guardRendererNavigation,
  type ElectronWindowOpenRequestHandler,
} from "./ElectronWindow";

export interface ElectronGameViewHandle {
  readonly native: WebContentsView;
  readonly webContents: WebContents;
  readonly getBounds: WebContentsView["getBounds"];
  readonly setBounds: WebContentsView["setBounds"];
  readonly setBackgroundColor: WebContentsView["setBackgroundColor"];
}

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
    options: WebContentsViewConstructorOptions,
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

const create: ElectronGameViewShape["create"] = (
  options,
  onWindowOpenRequest,
) =>
  Effect.try({
    try: () => {
      const view = new WebContentsView(options);
      const webContents = view.webContents;
      electronRendererRegistry.register(webContents);
      guardRendererNavigation(webContents, onWindowOpenRequest);
      return {
        native: view,
        // The native view clears its accessor after close; retain the contents for cleanup observers.
        webContents,
        getBounds: () => view.getBounds(),
        setBounds: (bounds) => view.setBounds(bounds),
        setBackgroundColor: (color) => view.setBackgroundColor(color),
      };
    },
    catch: (cause) => new ElectronGameViewCreateError({ cause }),
  });

const loadFile: ElectronGameViewShape["loadFile"] = (view, path, options) =>
  Effect.tryPromise({
    try: () => view.webContents.loadFile(path, options),
    catch: (cause) => new ElectronGameViewLoadError({ cause, path }),
  });

const onFocus: ElectronGameViewShape["onFocus"] = (view, listener) => {
  const webContents = view.webContents;
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

  view.webContents.close({ waitForBeforeUnload: false });
};

export const layer = Layer.succeed(
  ElectronGameView,
  ElectronGameView.of({ create, destroy, loadFile, onFocus }),
);
