import { randomBytes } from "crypto";

import type { BrowserWindowConstructorOptions } from "electron";

import { Context, Effect, Layer, Schema } from "effect";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronSession } from "../electron/ElectronSession";
import {
  ElectronWindow,
  type ElectronWindowHandle,
} from "../electron/ElectronWindow";
import {
  getDesktopWindowDefinition,
  type DesktopViewId,
  type DesktopWindowDefinition,
  type DesktopWindowKind,
} from "./DesktopWindowCatalog";

export type DesktopWindowInstanceId = string;

export class DesktopWindowError extends Schema.TaggedErrorClass<DesktopWindowError>()(
  "DesktopWindowError",
  {
    id: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DesktopWindowsShape {
  readonly open: (
    kind: DesktopWindowKind,
  ) => Effect.Effect<DesktopWindowInstanceId, DesktopWindowError>;
  readonly reveal: (
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<boolean, DesktopWindowError>;
}

export class DesktopWindows extends Context.Service<
  DesktopWindows,
  DesktopWindowsShape
>()("lucent/desktop/window/DesktopWindows") {}

const viewHtmlPath = (
  env: DesktopEnvironment["Service"],
  view: DesktopViewId,
): string => {
  if (view === "game") {
    return env.gameHtmlPath;
  }

  const exhaustive: never = view;
  return exhaustive;
};

const createWindowOptions = (
  env: DesktopEnvironment["Service"],
  definition: DesktopWindowDefinition,
): BrowserWindowConstructorOptions => ({
  width: definition.width,
  height: definition.height,
  ...(definition.minWidth === undefined
    ? {}
    : { minWidth: definition.minWidth }),
  ...(definition.minHeight === undefined
    ? {}
    : { minHeight: definition.minHeight }),
  ...(env.platform === "linux" ? { icon: env.appIconPath } : {}),
  backgroundColor: "#0e0e0f",
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    plugins: definition.requiresFlashPlugin,
  },
});

const isUsable = (
  window: ElectronWindowHandle | undefined,
): window is ElectronWindowHandle =>
  window !== undefined &&
  !window.isDestroyed() &&
  !window.webContents.isDestroyed();

interface DesktopWindowRecord {
  readonly kind: DesktopWindowKind;
  // ownerId is logical ownership only; Electron parent windows are intentionally not used.
  readonly ownerId?: DesktopWindowInstanceId;
  readonly window: ElectronWindowHandle;
}

const makeInstanceId = (kind: DesktopWindowKind): DesktopWindowInstanceId =>
  `${kind}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;

const makeDesktopWindows = Effect.gen(function* () {
  const app = yield* ElectronApp;
  const env = yield* DesktopEnvironment;
  const electronWindow = yield* ElectronWindow;
  const session = yield* ElectronSession;
  const observability = yield* DesktopObservability;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const windows = new Map<DesktopWindowInstanceId, DesktopWindowRecord>();

  const hasOpenRootGameWindows = (): boolean =>
    [...windows.values()].some(
      (record) =>
        record.kind === "game" &&
        record.ownerId === undefined &&
        isUsable(record.window),
    );

  const revealExisting = (id: DesktopWindowInstanceId) => {
    const record = windows.get(id);
    if (record === undefined || !isUsable(record.window)) {
      windows.delete(id);
      return Effect.succeed(false);
    }

    return electronWindow.reveal(record.window).pipe(Effect.as(true));
  };

  const reveal: DesktopWindowsShape["reveal"] = (id) =>
    revealExisting(id).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id,
            detail: `Failed to reveal desktop window: ${id}`,
            cause,
          }),
      ),
    );

  const open: DesktopWindowsShape["open"] = (kind) =>
    Effect.gen(function* () {
      const definition = getDesktopWindowDefinition(kind);
      const id = makeInstanceId(kind);
      const openEffect = Effect.gen(function* () {
        const window = yield* electronWindow.create(
          createWindowOptions(env, definition),
        );
        windows.set(id, { kind, window });
        if (kind === "game") {
          yield* session.installGameRequestHeaders({
            platform: env.platform,
            webContentsId: window.webContents.id,
          });
        }

        window.once("closed", () => {
          windows.delete(id);
          if (kind === "game" && !hasOpenRootGameWindows()) {
            void runPromise(app.quit);
          }
        });

        yield* electronWindow.loadFile(
          window,
          viewHtmlPath(env, definition.view),
        );
        yield* electronWindow.reveal(window);
        yield* observability.info("window", "Desktop window opened", {
          id,
          kind,
        });
        return id;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopWindowError({
              id,
              detail: `Failed to open desktop window: ${kind}`,
              cause,
            }),
        ),
      );

      return yield* openEffect;
    });

  return DesktopWindows.of({ open, reveal });
});

export const layer = Layer.effect(DesktopWindows, makeDesktopWindows);
