import { randomBytes } from "crypto";
import { join } from "path";

import { screen } from "electron";

import { Context, Effect, Layer, Schema } from "effect";

import {
  type AppearanceSnapshot,
  createAppearanceSnapshot,
  serializeDesktopViewArgument,
  serializeAppearanceSnapshotArgument,
  serializeSettingsSnapshotArgument,
} from "../../shared/appearance";
import {
  serializeDebugModeArgument,
  serializeGameConsoleObservabilityArgument,
} from "../../shared/rendererBootstrapArguments";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@lucent/core/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronSession } from "../electron/ElectronSession";
import { ElectronShell } from "../electron/ElectronShell";
import { ElectronTheme } from "../electron/ElectronTheme";
import {
  ElectronWindow,
  isElectronWindowUsable,
  type ElectronWindowCreateOptions,
  type ElectronWindowHandle,
} from "../electron/ElectronWindow";
import { DesktopSettings } from "../settings/DesktopSettings";
import {
  getDesktopWindowDefinition,
  type DesktopWindowDefinition,
  type DesktopWindowKind,
} from "./DesktopWindowCatalog";
import { parseAllowedGameWindowOpenUrl } from "./GameWindowOpenPolicy";
import {
  INITIAL_WINDOW_GENERATION,
  observeWindowReloads,
} from "./WindowGeneration";

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
  readonly closeBrowserWindow: (
    browserWindowId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly getBrowserWindowIds: (
    kind: DesktopWindowKind,
  ) => Effect.Effect<readonly number[]>;
  readonly getBrowserWindowId: (
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<number, DesktopWindowError>;
  readonly getBrowserWindowKind: (
    browserWindowId: number,
  ) => Effect.Effect<DesktopWindowKind | null, DesktopWindowError>;
  readonly getOwnedBrowserWindowIds: (
    ownerBrowserWindowId: number,
    kind?: DesktopWindowKind,
  ) => Effect.Effect<readonly number[], DesktopWindowError>;
  readonly getOwnerBrowserWindowId: (
    browserWindowId: number,
  ) => Effect.Effect<number | null, DesktopWindowError>;
  readonly onClosed: (
    listener: (event: DesktopWindowClosedEvent) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onCreated: (
    listener: (
      event: DesktopWindowCreatedEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onRendererDestroyed: (
    listener: (
      event: DesktopWindowRendererDestroyedEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly onRendererReloaded: (
    listener: (
      event: DesktopWindowRendererReloadedEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly open: (
    kind: DesktopWindowKind,
    options?: DesktopWindowOpenOptions,
  ) => Effect.Effect<DesktopWindowInstanceId, DesktopWindowError>;
  readonly reveal: (
    id: DesktopWindowInstanceId,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly revealBrowserWindow: (
    browserWindowId: number,
  ) => Effect.Effect<boolean, DesktopWindowError>;
  readonly setBackgroundColor: (backgroundColor: string) => Effect.Effect<void>;
}

export class DesktopWindows extends Context.Service<
  DesktopWindows,
  DesktopWindowsShape
>()("lucent/desktop/window/DesktopWindows") {}

export type DesktopWindowTileAlgorithm =
  | "auto-grid"
  | "horizontal"
  | "vertical";

export interface DesktopWindowTilePlacement {
  readonly algorithm: DesktopWindowTileAlgorithm;
  readonly count: number;
  readonly index: number;
}

export interface DesktopWindowOpenOptions {
  readonly onCreated?: (
    event: DesktopWindowCreatedEvent,
  ) => Effect.Effect<void, unknown>;
  readonly ownerBrowserWindowId?: number;
  readonly tile?: DesktopWindowTilePlacement;
}

interface DesktopWindowBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const rendererRoot = join(__dirname, "../renderer");
const preloadPath = join(rendererRoot, "preload.js");

const viewHtmlPath = (kind: DesktopWindowKind): string =>
  join(rendererRoot, kind, "index.html");

const normalizeTilePlacement = (
  tile: DesktopWindowTilePlacement | undefined,
): DesktopWindowTilePlacement | undefined => {
  if (
    tile === undefined ||
    !Number.isSafeInteger(tile.index) ||
    !Number.isSafeInteger(tile.count) ||
    tile.index < 0 ||
    tile.count <= 1 ||
    tile.index >= tile.count
  ) {
    return undefined;
  }

  return tile;
};

const gridForTilePlacement = (
  tile: DesktopWindowTilePlacement,
): { readonly columns: number; readonly rows: number } => {
  switch (tile.algorithm) {
    case "auto-grid": {
      const columns = Math.ceil(Math.sqrt(tile.count));
      return { columns, rows: Math.ceil(tile.count / columns) };
    }
    case "horizontal":
      return { columns: tile.count, rows: 1 };
    case "vertical":
      return { columns: 1, rows: tile.count };
  }
};

const partitionDimension = (
  origin: number,
  size: number,
  index: number,
  parts: number,
): { readonly origin: number; readonly size: number } => {
  const normalizedSize = Math.max(1, Math.round(size));
  const start = origin + Math.floor((normalizedSize * index) / parts);
  const end = origin + Math.floor((normalizedSize * (index + 1)) / parts);
  return {
    origin: start,
    size: Math.max(1, end - start),
  };
};

const resolveTileBounds = (
  tile: DesktopWindowTilePlacement | undefined,
): DesktopWindowBounds | undefined => {
  const normalizedTile = normalizeTilePlacement(tile);
  if (normalizedTile === undefined) {
    return undefined;
  }

  const workArea = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  const { columns, rows } = gridForTilePlacement(normalizedTile);
  const column = normalizedTile.index % columns;
  const row = Math.floor(normalizedTile.index / columns);
  const x = partitionDimension(workArea.x, workArea.width, column, columns);
  const y = partitionDimension(workArea.y, workArea.height, row, rows);

  return {
    height: y.size,
    width: x.size,
    x: x.origin,
    y: y.origin,
  };
};

const createWindowOptions = (
  env: DesktopEnvironment["Service"],
  definition: DesktopWindowDefinition,
  settings: AppSettings,
  snapshot: AppearanceSnapshot,
  bounds?: DesktopWindowBounds,
): ElectronWindowCreateOptions => {
  const width = bounds?.width ?? definition.width;
  const height = bounds?.height ?? definition.height;

  return {
    width,
    height,
    ...(bounds === undefined ? {} : { x: bounds.x, y: bounds.y }),
    ...(definition.minWidth === undefined
      ? {}
      : { minWidth: Math.min(definition.minWidth, width) }),
    ...(definition.minHeight === undefined
      ? {}
      : { minHeight: Math.min(definition.minHeight, height) }),
    ...(env.platform === "linux" ? { icon: env.appIconPath } : {}),
    backgroundColor: snapshot.backgroundColor,
    show: false,
    webPreferences: {
      additionalArguments: [
        serializeDesktopViewArgument(definition.kind),
        serializeAppearanceSnapshotArgument(snapshot),
        serializeSettingsSnapshotArgument(settings),
        ...(env.debug === true ? [serializeDebugModeArgument()] : []),
        ...(definition.kind === "game" && env.debug === true
          ? [serializeGameConsoleObservabilityArgument()]
          : []),
      ],
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false,
      plugins: definition.requiresFlashPlugin,
    },
  };
};

interface DesktopWindowRecord {
  readonly browserWindowId: number;
  readonly kind: DesktopWindowKind;
  // ownerId is logical ownership only; Electron parent windows are intentionally not used.
  readonly ownerId?: DesktopWindowInstanceId;
  readonly window: ElectronWindowHandle;
}

export interface DesktopWindowClosedEvent {
  readonly browserWindowId: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowCreatedEvent {
  readonly browserWindowId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererDestroyedEvent {
  readonly browserWindowId: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
}

export interface DesktopWindowRendererReloadedEvent {
  readonly browserWindowId: number;
  readonly generation: number;
  readonly id: DesktopWindowInstanceId;
  readonly kind: DesktopWindowKind;
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
  const electronShell = yield* ElectronShell;
  const observability = yield* DesktopObservability;
  const settings = yield* DesktopSettings;
  const theme = yield* ElectronTheme;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const windows = new Map<DesktopWindowInstanceId, DesktopWindowRecord>();
  const createdListeners = new Set<
    (event: DesktopWindowCreatedEvent) => Effect.Effect<void, unknown>
  >();
  const closedListeners = new Set<
    (event: DesktopWindowClosedEvent) => Effect.Effect<void, unknown>
  >();
  const rendererDestroyedListeners = new Set<
    (event: DesktopWindowRendererDestroyedEvent) => Effect.Effect<void, unknown>
  >();
  const rendererReloadedListeners = new Set<
    (event: DesktopWindowRendererReloadedEvent) => Effect.Effect<void, unknown>
  >();
  let appIsQuitting = false;

  const openAllowedGameUrl = (rawUrl: string): void => {
    const url = parseAllowedGameWindowOpenUrl(rawUrl);
    if (url === null) {
      return;
    }

    void runPromise(
      electronShell.openExternal(url).pipe(
        Effect.flatMap((opened) =>
          opened
            ? Effect.void
            : observability.warn("window", "Failed to open game URL", {
                url,
              }),
        ),
      ),
    ).catch(() => undefined);
  };

  const unsubscribeBeforeQuit = yield* app.on("before-quit", () => {
    appIsQuitting = true;
  });
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeBeforeQuit));

  const hasOpenRootGameWindows = (): boolean =>
    [...windows.values()].some(
      (record) =>
        record.kind === "game" &&
        record.ownerId === undefined &&
        isElectronWindowUsable(record.window),
    );

  const hasOpenWindowKind = (kind: DesktopWindowKind): boolean =>
    [...windows.values()].some(
      (record) => record.kind === kind && isElectronWindowUsable(record.window),
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

  const findBrowserWindowEntry = (
    browserWindowId: number,
  ): readonly [DesktopWindowInstanceId, DesktopWindowRecord] | null => {
    for (const entry of windows.entries()) {
      const [id, record] = entry;
      if (record.browserWindowId === browserWindowId) {
        if (isElectronWindowUsable(record.window)) {
          return entry;
        }

        windows.delete(id);
        return null;
      }
    }
    return null;
  };

  const getBrowserWindowId: DesktopWindowsShape["getBrowserWindowId"] = (id) =>
    Effect.sync(() => {
      const record = windows.get(id);
      if (record === undefined || !isElectronWindowUsable(record.window)) {
        throw new Error(`Desktop window is not open: ${id}`);
      }

      return record.browserWindowId;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id,
            detail: `Failed to resolve Electron window id: ${id}`,
            cause,
          }),
      ),
    );

  const getBrowserWindowIds: DesktopWindowsShape["getBrowserWindowIds"] = (
    kind,
  ) =>
    Effect.sync(() =>
      [...windows.values()]
        .filter(
          (record) =>
            record.kind === kind && isElectronWindowUsable(record.window),
        )
        .map((record) => record.browserWindowId),
    );

  const getBrowserWindowKind: DesktopWindowsShape["getBrowserWindowKind"] = (
    browserWindowId,
  ) =>
    Effect.sync(() => {
      const entry = findBrowserWindowEntry(browserWindowId);
      return entry === null ? null : entry[1].kind;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to resolve Electron window kind: ${browserWindowId}`,
            cause,
          }),
      ),
    );

  const getOwnerBrowserWindowId: DesktopWindowsShape["getOwnerBrowserWindowId"] =
    (browserWindowId) =>
      Effect.sync(() => {
        const entry = findBrowserWindowEntry(browserWindowId);
        if (entry === null) {
          return null;
        }

        const ownerId = entry[1].ownerId;
        if (ownerId === undefined) {
          return null;
        }

        const owner = windows.get(ownerId);
        return owner === undefined || !isElectronWindowUsable(owner.window)
          ? null
          : owner.browserWindowId;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopWindowError({
              id: String(browserWindowId),
              detail: `Failed to resolve Electron window owner: ${browserWindowId}`,
              cause,
            }),
        ),
      );

  const getOwnedBrowserWindowIds: DesktopWindowsShape["getOwnedBrowserWindowIds"] =
    (ownerBrowserWindowId, kind) =>
      Effect.try({
        try: () => {
          const owner = findBrowserWindowEntry(ownerBrowserWindowId);
          if (owner === null) {
            throw new Error(
              `Desktop window owner is not open: ${ownerBrowserWindowId}`,
            );
          }

          const [ownerId] = owner;
          return [...windows.values()]
            .filter(
              (record) =>
                record.ownerId === ownerId &&
                (kind === undefined || record.kind === kind) &&
                isElectronWindowUsable(record.window),
            )
            .map((record) => record.browserWindowId);
        },
        catch: (cause) =>
          new DesktopWindowError({
            id: String(ownerBrowserWindowId),
            detail: `Failed to resolve owned Electron windows: ${ownerBrowserWindowId}`,
            cause,
          }),
      });

  const revealBrowserWindow: DesktopWindowsShape["revealBrowserWindow"] = (
    browserWindowId,
  ) =>
    Effect.gen(function* () {
      const entry = findBrowserWindowEntry(browserWindowId);
      if (entry === null) {
        return false;
      }

      const [, record] = entry;
      yield* electronWindow.reveal(record.window);
      return true;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to reveal Electron window: ${browserWindowId}`,
            cause,
          }),
      ),
    );

  const closeBrowserWindow: DesktopWindowsShape["closeBrowserWindow"] = (
    browserWindowId,
  ) =>
    Effect.sync(() => {
      const entry = findBrowserWindowEntry(browserWindowId);
      if (entry === null) {
        return false;
      }

      const [, record] = entry;
      record.window.close();
      return true;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopWindowError({
            id: String(browserWindowId),
            detail: `Failed to close Electron window: ${browserWindowId}`,
            cause,
          }),
      ),
    );

  const onClosed: DesktopWindowsShape["onClosed"] = (listener) =>
    Effect.sync(() => {
      closedListeners.add(listener);
      return () => {
        closedListeners.delete(listener);
      };
    });

  const onCreated: DesktopWindowsShape["onCreated"] = (listener) =>
    Effect.sync(() => {
      createdListeners.add(listener);
      return () => {
        createdListeners.delete(listener);
      };
    });

  const onRendererDestroyed: DesktopWindowsShape["onRendererDestroyed"] = (
    listener,
  ) =>
    Effect.sync(() => {
      rendererDestroyedListeners.add(listener);
      return () => {
        rendererDestroyedListeners.delete(listener);
      };
    });

  const onRendererReloaded: DesktopWindowsShape["onRendererReloaded"] = (
    listener,
  ) =>
    Effect.sync(() => {
      rendererReloadedListeners.add(listener);
      return () => {
        rendererReloadedListeners.delete(listener);
      };
    });

  const setBackgroundColor: DesktopWindowsShape["setBackgroundColor"] = (
    backgroundColor,
  ) =>
    Effect.forEach(
      windows.entries(),
      ([id, record]) => {
        if (!isElectronWindowUsable(record.window)) {
          windows.delete(id);
          return Effect.void;
        }

        return Effect.try({
          try: () => record.window.setBackgroundColor(backgroundColor),
          catch: (cause) =>
            new DesktopWindowError({
              id,
              detail: `Failed to update desktop window background: ${id}`,
              cause,
            }),
        }).pipe(
          Effect.catch((cause) =>
            observability.warn(
              "window",
              "Failed to update desktop window background",
              { cause, id },
            ),
          ),
        );
      },
      { discard: true },
    );

  const findOpenInstance = (
    kind: DesktopWindowKind,
    ownerId: DesktopWindowInstanceId | undefined,
  ): readonly [DesktopWindowInstanceId, DesktopWindowRecord] | null => {
    for (const entry of windows.entries()) {
      const [, record] = entry;
      if (
        record.kind === kind &&
        record.ownerId === ownerId &&
        isElectronWindowUsable(record.window)
      ) {
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

  const open: DesktopWindowsShape["open"] = (kind, options) =>
    Effect.gen(function* () {
      const definition = getDesktopWindowDefinition(kind);
      const ownerId = yield* Effect.try({
        try: () => {
          if (definition.scope !== "game-child") {
            if (options?.ownerBrowserWindowId !== undefined) {
              throw new Error(
                `${kind} does not accept a logical owner window.`,
              );
            }
            return undefined;
          }

          if (options?.ownerBrowserWindowId === undefined) {
            throw new Error(`${kind} requires an owning game window.`);
          }

          const owner = findBrowserWindowEntry(options.ownerBrowserWindowId);
          if (
            owner === null ||
            owner[1].kind !== "game" ||
            owner[1].ownerId !== undefined
          ) {
            throw new Error(
              `The owning window must be an open root game: ${options.ownerBrowserWindowId}`,
            );
          }

          return owner[0];
        },
        catch: (cause) =>
          new DesktopWindowError({
            id: kind,
            detail: `Invalid logical owner for desktop window: ${kind}`,
            cause,
          }),
      });
      if (definition.singleInstance) {
        const existing = findOpenInstance(kind, ownerId);
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

        const bounds = resolveTileBounds(options?.tile);
        const window = yield* electronWindow.create(
          createWindowOptions(
            env,
            definition,
            bootstrapSettings,
            snapshot,
            bounds,
          ),
          kind === "game" ? openAllowedGameUrl : undefined,
        );
        const browserWindowId = window.id;
        const webContents = window.webContents;
        windows.set(id, {
          browserWindowId,
          kind,
          ...(ownerId === undefined ? {} : { ownerId }),
          window,
        });
        const createdEvent: DesktopWindowCreatedEvent = {
          browserWindowId,
          generation: INITIAL_WINDOW_GENERATION,
          id,
          kind,
        };
        const rendererDestroyedEvent: DesktopWindowRendererDestroyedEvent = {
          browserWindowId,
          id,
          kind,
        };
        const stopObservingWindowReloads = observeWindowReloads(
          webContents,
          (generation) => {
            const reloadedEvent: DesktopWindowRendererReloadedEvent = {
              browserWindowId,
              generation,
              id,
              kind,
            };
            for (const listener of rendererReloadedListeners) {
              void runPromise(listener(reloadedEvent)).catch(() => undefined);
            }
          },
        );

        webContents.on("destroyed", () => {
          stopObservingWindowReloads();
          for (const listener of rendererDestroyedListeners) {
            void runPromise(listener(rendererDestroyedEvent)).catch(
              () => undefined,
            );
          }
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
          stopObservingWindowReloads();
          const closedEvent: DesktopWindowClosedEvent = {
            browserWindowId,
            id,
            kind,
          };
          windows.delete(id);
          for (const record of windows.values()) {
            if (
              record.ownerId === id &&
              isElectronWindowUsable(record.window)
            ) {
              record.window.destroy();
            }
          }
          for (const listener of closedListeners) {
            void runPromise(listener(closedEvent)).catch(() => undefined);
          }
          if (
            kind === "game" &&
            !hasOpenRootGameWindows() &&
            !hasOpenWindowKind("account-manager")
          ) {
            void runPromise(app.quit);
          }
        });

        for (const listener of createdListeners) {
          yield* listener(createdEvent).pipe(Effect.catch(() => Effect.void));
        }

        if (options?.onCreated !== undefined) {
          yield* options.onCreated(createdEvent);
        }

        yield* electronWindow.loadFile(window, viewHtmlPath(definition.kind));
        if (env.debug === true) {
          yield* Effect.try({
            try: () => webContents.openDevTools({ mode: "right" }),
            catch: (cause) =>
              new DesktopWindowError({
                id,
                detail: `Failed to open DevTools for desktop window: ${id}`,
                cause,
              }),
          }).pipe(
            Effect.catch((cause) =>
              observability.warn("window", "Failed to open DevTools", {
                cause,
                id,
                kind,
              }),
            ),
          );
        }
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

  return DesktopWindows.of({
    closeBrowserWindow,
    getBrowserWindowIds,
    getBrowserWindowId,
    getBrowserWindowKind,
    getOwnedBrowserWindowIds,
    getOwnerBrowserWindowId,
    onClosed,
    onCreated,
    onRendererDestroyed,
    onRendererReloaded,
    open,
    reveal,
    revealBrowserWindow,
    setBackgroundColor,
  });
});

export const layer = Layer.effect(DesktopWindows, makeDesktopWindows);
