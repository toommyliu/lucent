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
import type * as Scope from "effect/Scope";

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
  ) => Effect.Effect<
    ElectronGameViewHandle,
    ElectronGameViewCreateError,
    Scope.Scope
  >;
  readonly loadFile: (
    view: ElectronGameViewHandle,
    path: string,
    options?: LoadFileOptions,
  ) => Effect.Effect<void, ElectronGameViewLoadError>;
}

export class ElectronGameView extends Context.Service<
  ElectronGameView,
  ElectronGameViewShape
>()("lucent/desktop/electron/ElectronGameView") {}

const create: ElectronGameViewShape["create"] = Effect.fn(
  "ElectronGameView.create",
)(function* (options, onWindowOpenRequest) {
  const { view, webContents } = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const view = new WebContentsView(options);
        return { view, webContents: view.webContents };
      },
      catch: (cause) => new ElectronGameViewCreateError({ cause }),
    }),
    ({ webContents }) =>
      Effect.sync(() => {
        if (!webContents.isDestroyed())
          webContents.close({ waitForBeforeUnload: false });
      }),
  );
  yield* Effect.try({
    try: () => {
      electronRendererRegistry.register(webContents);
      guardRendererNavigation(webContents, onWindowOpenRequest);
    },
    catch: (cause) => new ElectronGameViewCreateError({ cause }),
  });
  return {
    native: view,
    webContents,
    getBounds: () => view.getBounds(),
    setBounds: (bounds) => view.setBounds(bounds),
    setBackgroundColor: (color) => view.setBackgroundColor(color),
  };
});

const loadFile: ElectronGameViewShape["loadFile"] = (view, path, options) =>
  Effect.tryPromise({
    try: () => view.webContents.loadFile(path, options),
    catch: (cause) => new ElectronGameViewLoadError({ cause, path }),
  });

export const layer = Layer.succeed(
  ElectronGameView,
  ElectronGameView.of({ create, loadFile }),
);
