import { randomBytes } from "crypto";
import { join } from "path";

import type { BrowserWindowConstructorOptions } from "electron";

import { Context, Effect, Layer, Schema } from "effect";

import {
  type AppearanceSnapshot,
  createAppearanceSnapshot,
  serializeDesktopViewArgument,
  serializeAppearanceSnapshotArgument,
  serializeSettingsSnapshotArgument,
} from "../../shared/appearance";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../shared/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronSession } from "../electron/ElectronSession";
import { ElectronTheme } from "../electron/ElectronTheme";
import {
  ElectronWindow,
  isElectronWindowUsable,
  type ElectronWindowHandle,
} from "../electron/ElectronWindow";
import { DesktopSettings } from "../settings/DesktopSettings";
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
): string => join(env.rendererDir, view, "index.html");

const createWindowOptions = (
  env: DesktopEnvironment["Service"],
  definition: DesktopWindowDefinition,
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
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
  backgroundColor: snapshot.backgroundColor,
  show: false,
  webPreferences: {
    additionalArguments: [
      serializeDesktopViewArgument(definition.view),
      serializeAppearanceSnapshotArgument(snapshot),
      serializeSettingsSnapshotArgument(settings),
    ],
    contextIsolation: true,
    nodeIntegration: false,
    preload: env.preloadPath,
    sandbox: false,
    plugins: definition.requiresFlashPlugin,
  },
});

interface DesktopWindowRecord {
  readonly kind: DesktopWindowKind;
  // ownerId is logical ownership only; Electron parent windows are intentionally not used.
  readonly ownerId?: DesktopWindowInstanceId;
  readonly window: ElectronWindowHandle;
}

const makeInstanceId = (kind: DesktopWindowKind): DesktopWindowInstanceId =>
  `${kind}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;

const preventWindowClose = (event: unknown): void => {
  if (
    typeof event === "object" &&
    event !== null &&
    "preventDefault" in event &&
    typeof event.preventDefault === "function"
  ) {
    event.preventDefault();
  }
};

const makeDesktopWindows = Effect.gen(function* () {
  const app = yield* ElectronApp;
  const env = yield* DesktopEnvironment;
  const electronWindow = yield* ElectronWindow;
  const electronSession = yield* ElectronSession;
  const observability = yield* DesktopObservability;
  const settings = yield* DesktopSettings;
  const theme = yield* ElectronTheme;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const windows = new Map<DesktopWindowInstanceId, DesktopWindowRecord>();
  let appIsQuitting = false;

  yield* app.on("before-quit", () => {
    appIsQuitting = true;
  });

  const hasOpenRootGameWindows = (): boolean =>
    [...windows.values()].some(
      (record) =>
        record.kind === "game" &&
        record.ownerId === undefined &&
        isElectronWindowUsable(record.window),
    );

  const revealExisting = (id: DesktopWindowInstanceId) => {
    const record = windows.get(id);
    if (record === undefined || !isElectronWindowUsable(record.window)) {
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

  const findOpenInstance = (
    kind: DesktopWindowKind,
  ): readonly [DesktopWindowInstanceId, DesktopWindowRecord] | null => {
    for (const entry of windows.entries()) {
      const [, record] = entry;
      if (record.kind === kind && isElectronWindowUsable(record.window)) {
        return entry;
      }
    }
    return null;
  };

  const getBootstrapSettings = settings.get.pipe(
    Effect.catch((cause) =>
      observability
        .warn(
          "window",
          "Falling back to default settings for window bootstrap",
          {
            cause,
          },
        )
        .pipe(Effect.as(DEFAULT_APP_SETTINGS)),
    ),
  );

  const open: DesktopWindowsShape["open"] = (kind) =>
    Effect.gen(function* () {
      const definition = getDesktopWindowDefinition(kind);
      if (definition.singleInstance) {
        const existing = findOpenInstance(kind);
        if (existing !== null) {
          const [id] = existing;
          yield* revealExisting(id);
          return id;
        }
      }

      const id = makeInstanceId(kind);
      const openEffect = Effect.gen(function* () {
        const bootstrapSettings = yield* getBootstrapSettings;
        const systemPrefersDark = yield* theme.shouldUseDarkColors;
        const snapshot = createAppearanceSnapshot(
          bootstrapSettings,
          systemPrefersDark,
        );
        if (definition.requiresFlashPlugin) {
          yield* electronSession.prepareGameNetworking;
        }

        const window = yield* electronWindow.create(
          createWindowOptions(env, definition, bootstrapSettings, snapshot),
        );
        windows.set(id, {
          kind,
          window,
        });

        if (definition.closeBehavior === "hide") {
          window.on("close", (event) => {
            if (appIsQuitting || window.isDestroyed()) {
              return;
            }

            preventWindowClose(event);
            window.hide();
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
