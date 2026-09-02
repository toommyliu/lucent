import { promises as fs } from "fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { extname, isAbsolute, relative, resolve, sep } from "path";

import { ipcMain, type IpcMainEvent } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import type { AccountManagerState } from "@lucent/core/accounts";
import { GameConsoleIpc } from "../../../shared/ipc";
import { Accounts } from "../../internal/accounts/Accounts";
import { DesktopWindows } from "../../window/DesktopWindows";
import { DesktopObservability } from "./DesktopObservability";
import {
  type GameConsoleMessageQuery,
  type GameConsoleStore,
  makeGameConsoleStore,
  messagesToNdjson,
  sessionsFromAccountState,
} from "./GameConsoleStore";

export const DEFAULT_DESKTOP_OBSERVABILITY_PORT = 10_637;

const DEFAULT_OBSERVABILITY_ASSET_ROOT = resolve(
  __dirname,
  "..",
  "observability",
);
const OBSERVABILITY_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface DesktopObservabilityServerOptions {
  readonly port: number;
}

export interface DesktopObservabilityServerInstall {
  readonly port: number;
  readonly url: string;
}

export class DesktopObservabilityServerStartError extends Schema.TaggedError<DesktopObservabilityServerStartError>()(
  "DesktopObservabilityServerStartError",
  {
    port: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to start the desktop observability server on port ${this.port}.`;
  }
}

interface DesktopObservabilityHttpHandlerOptions {
  readonly assetRoot: string;
  readonly consoleClients: Set<SseClient>;
  readonly traceClients: Set<SseClient>;
  readonly traceSnapshot: DesktopObservability["Service"]["traceSnapshot"];
}

const decodeRendererMessagePayload = Option.liftThrowable(
  GameConsoleIpc.rendererMessage.decodePayload,
);

const parsePositiveInteger = (value: string | null): number | undefined => {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseMessageQuery = (url: URL): GameConsoleMessageQuery => {
  const query: {
    generation?: number;
    limit?: number;
    q?: string;
    sinceId?: number;
    username?: string;
    windowId?: number;
  } = {};
  const generation = parsePositiveInteger(url.searchParams.get("generation"));
  const sinceId = parsePositiveInteger(url.searchParams.get("sinceId"));
  const limit = parsePositiveInteger(url.searchParams.get("limit"));
  const windowId = parsePositiveInteger(url.searchParams.get("windowId"));
  const username = url.searchParams.get("username")?.trim();
  const q = url.searchParams.get("q")?.trim();

  if (generation !== undefined) {
    query.generation = generation;
  }
  if (sinceId !== undefined) {
    query.sinceId = sinceId;
  }
  if (limit !== undefined) {
    query.limit = limit;
  }
  if (windowId !== undefined) {
    query.windowId = windowId;
  }
  if (username !== undefined && username.length > 0) {
    query.username = username;
  }
  if (q !== undefined && q.length > 0) {
    query.q = q;
  }

  return query;
};

const writeResponse = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Uint8Array,
): void => {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", contentType);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
};

const writeJson = (
  response: ServerResponse,
  value: unknown,
  status = 200,
): void => {
  writeResponse(
    response,
    status,
    "application/json; charset=utf-8",
    JSON.stringify(value),
  );
};

const errorCode = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause
    ? (cause as NodeJS.ErrnoException).code
    : undefined;

const contentTypeFor = (path: string): string =>
  CONTENT_TYPES[extname(path).toLocaleLowerCase()] ??
  "application/octet-stream";

const observabilityAssetPath = (assetRoot: string, url: URL): string | null => {
  let requestedPath: string;
  if (url.pathname === "/") {
    requestedPath = "index.html";
  } else if (url.pathname.startsWith("/assets/")) {
    try {
      requestedPath = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const root = resolve(assetRoot);
  const assetPath = resolve(root, requestedPath);
  const pathFromRoot = relative(root, assetPath);
  if (
    pathFromRoot.startsWith(`..${sep}`) ||
    pathFromRoot === ".." ||
    isAbsolute(pathFromRoot)
  ) {
    return null;
  }
  return assetPath;
};

const serveObservabilityAsset = (
  response: ServerResponse,
  path: string | null,
): void => {
  response.setHeader(
    "Content-Security-Policy",
    OBSERVABILITY_CONTENT_SECURITY_POLICY,
  );
  if (path === null) {
    writeResponse(response, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }

  void fs
    .readFile(path)
    .then((body) => writeResponse(response, 200, contentTypeFor(path), body))
    .catch((cause: unknown) => {
      if (errorCode(cause) === "ENOENT" || errorCode(cause) === "EISDIR") {
        writeResponse(response, 404, "text/plain; charset=utf-8", "Not found");
        return;
      }
      writeResponse(
        response,
        500,
        "text/plain; charset=utf-8",
        "Failed to read an observability viewer asset",
      );
    });
};

interface SseSnapshot {
  readonly event: string;
  readonly read: () => unknown;
}

interface SseClient {
  readonly close: () => void;
  readonly publish: (event: string, data: unknown) => void;
}

const ssePayload = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const openSse = (
  request: IncomingMessage,
  response: ServerResponse,
  clients: Set<SseClient>,
  snapshot?: SseSnapshot,
): void => {
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  let blocked = false;
  let closed = false;
  let needsSnapshot = false;

  const remove = (): void => {
    clients.delete(client);
    response.removeListener("drain", handleDrain);
  };
  const fail = (): void => {
    if (closed) return;
    closed = true;
    remove();
    response.destroy();
  };
  const write = (payload: string): void => {
    try {
      blocked = !response.write(payload);
    } catch {
      fail();
    }
  };
  const publish = (event: string, data: unknown): void => {
    if (closed) return;
    if (blocked) {
      if (snapshot === undefined) {
        fail();
      } else {
        needsSnapshot = true;
      }
      return;
    }
    try {
      write(ssePayload(event, data));
    } catch {
      fail();
    }
  };
  const refreshSnapshot = (): void => {
    if (snapshot === undefined || closed) return;
    needsSnapshot = false;
    publish(snapshot.event, snapshot.read());
  };
  function handleDrain(): void {
    blocked = false;
    if (needsSnapshot) refreshSnapshot();
  }
  const close = (): void => {
    if (closed) return;
    closed = true;
    remove();
    response.end();
  };
  const client: SseClient = { close, publish };

  clients.add(client);
  response.on("drain", handleDrain);
  request.once("close", close);
  write(": connected\n\n");
  refreshSnapshot();
};

const publishSseEvent = (
  clients: Set<SseClient>,
  event: string,
  data: unknown,
): void => {
  for (const client of clients) {
    client.publish(event, data);
  }
};

const closeSseClients = (clients: Set<SseClient>): void => {
  for (const client of clients) {
    client.close();
  }
};

/**
 * Local observability routes available on 127.0.0.1 under `--debug`.
 *
 * - `/?view=console` and `/?view=traces` render the observability viewer.
 * - `/assets/*` serves the viewer's bundled assets.
 * - `/api/messages` returns game-console rows. Optional filters are `sinceId`,
 *   `limit`, `windowId`, `generation`, `username`, and `q`.
 * - `/api/messages.ndjson` returns the same rows as newline-delimited JSON.
 * - `/api/state` returns the game-console buffer and window state.
 * - `/api/traces` returns the bounded in-memory completed-span snapshot.
 * - `/events` streams game-console and window-state events with SSE.
 * - `/trace-events` streams newly completed app-wide spans with SSE.
 * - `/health` returns the server and game-console buffer status.
 */
export const createDesktopObservabilityHttpHandler =
  (
    store: GameConsoleStore,
    options: DesktopObservabilityHttpHandlerOptions,
  ): ((request: IncomingMessage, response: ServerResponse) => void) =>
  (request, response) => {
    if (request.method !== "GET") {
      writeJson(response, { error: "Method not allowed" }, 405);
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const assetPath = observabilityAssetPath(options.assetRoot, url);
    if (assetPath !== null) {
      serveObservabilityAsset(response, assetPath);
      return;
    }

    switch (url.pathname) {
      case "/api/messages":
        writeJson(response, store.queryMessages(parseMessageQuery(url)));
        return;
      case "/api/messages.ndjson":
        writeResponse(
          response,
          200,
          "application/x-ndjson; charset=utf-8",
          messagesToNdjson(store.queryMessages(parseMessageQuery(url))),
        );
        return;
      case "/api/state":
        writeJson(response, store.state());
        return;
      case "/api/traces":
        writeJson(response, options.traceSnapshot());
        return;
      case "/events":
        openSse(request, response, options.consoleClients);
        return;
      case "/trace-events":
        openSse(request, response, options.traceClients, {
          event: "snapshot",
          read: options.traceSnapshot,
        });
        return;
      case "/health": {
        const state = store.state();
        writeJson(response, {
          ok: true,
          activeGameWindowCount: state.activeGameWindowCount,
          buffer: state.buffer,
        });
        return;
      }
      default:
        writeJson(response, { error: "Not found" }, 404);
        return;
    }
  };

const startHttpServer = (
  server: Server,
  port: number,
): Promise<DesktopObservabilityServerInstall> =>
  new Promise((resolveStart, rejectStart) => {
    const rejectOnce = (cause: unknown): void => {
      server.removeListener("listening", resolveOnce);
      rejectStart(cause);
    };
    const resolveOnce = (): void => {
      server.removeListener("error", rejectOnce);
      const address = server.address();
      const resolvedPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolveStart({
        port: resolvedPort,
        url: `http://127.0.0.1:${resolvedPort}`,
      });
    };

    server.once("error", rejectOnce);
    server.once("listening", resolveOnce);
    server.listen(port, "127.0.0.1");
  });

export interface DesktopObservabilityServerShape {
  readonly install: (
    options: DesktopObservabilityServerOptions,
  ) => Effect.Effect<
    DesktopObservabilityServerInstall,
    DesktopObservabilityServerStartError,
    Scope.Scope
  >;
}

export class DesktopObservabilityServer extends Context.Service<
  DesktopObservabilityServer,
  DesktopObservabilityServerShape
>()("lucent/desktop/app/observability/DesktopObservabilityServer") {}

const makeDesktopObservabilityServer = Effect.gen(function* () {
  const accounts = yield* Accounts;
  const observability = yield* DesktopObservability;
  const windows = yield* DesktopWindows;

  const install: DesktopObservabilityServerShape["install"] = Effect.fn(
    "DesktopObservabilityServer.install",
  )(function* (options) {
    const store = makeGameConsoleStore();
    const consoleClients = new Set<SseClient>();
    const traceClients = new Set<SseClient>();
    const publishConsole = (event: string, data: unknown): void => {
      publishSseEvent(consoleClients, event, data);
    };
    const applyAccountState = (state: AccountManagerState): void => {
      for (const windowState of store.updateSessions(
        sessionsFromAccountState(state),
      )) {
        publishConsole("session-updated", windowState);
      }
    };
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const handleRendererMessage = (
      event: IpcMainEvent,
      rawPayload: unknown,
    ): void => {
      const decodedPayload = decodeRendererMessagePayload(rawPayload);
      if (Option.isNone(decodedPayload)) {
        return;
      }
      const payload = decodedPayload.value;
      const rendererId = event.sender.id;

      void runPromise(
        windows.getRendererKind(rendererId).pipe(
          Effect.flatMap((kind) =>
            kind === "game"
              ? observability
                  .record({
                    component: "renderer",
                    event: "console",
                    data: {
                      message: payload.message,
                      rendererId,
                      view: kind,
                    },
                  })
                  .pipe(
                    Effect.flatMap(() =>
                      Effect.sync(() => {
                        const row = store.appendMessage({
                          gameWindowId: rendererId,
                          message: payload.message,
                        });
                        publishConsole("message", row);
                      }),
                    ),
                  )
              : Effect.void,
          ),
          Effect.catch(() => Effect.void),
        ),
      ).catch(() => undefined);
    };

    const unsubscribeCreated = yield* windows.onCreated((event) => {
      if (event.kind !== "game") {
        return Effect.void;
      }

      return Effect.sync(() => {
        const windowState = store.openWindow(
          event.rendererId,
          undefined,
          event.generation,
        );
        publishConsole("window-opened", windowState);
      });
    });
    const unsubscribeReloaded = yield* windows.onRendererReloaded((event) => {
      if (event.kind !== "game") {
        return Effect.void;
      }

      return Effect.sync(() => {
        const windowState = store.beginWindowGeneration(
          event.rendererId,
          event.generation,
        );
        publishConsole("window-generation", windowState);
      });
    });
    const unsubscribeClosed = yield* windows.onClosed((event) => {
      if (event.kind !== "game") {
        return Effect.void;
      }

      return Effect.sync(() => {
        const windowState = store.closeWindow(event.rendererId);
        publishConsole("window-closed", windowState);
      });
    });
    const initialState = yield* accounts.getState.pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (initialState !== null) {
      yield* Effect.sync(() => {
        applyAccountState(initialState);
      });
    }
    const unsubscribeAccounts = yield* accounts.onChanged((state) => {
      applyAccountState(state);
    });
    yield* Effect.sync(() => {
      ipcMain.on(GameConsoleIpc.rendererMessage.channel, handleRendererMessage);
    });

    const unsubscribeTraces = observability.subscribeTrace((span) => {
      publishSseEvent(traceClients, "span", span);
    });
    const server = createServer(
      createDesktopObservabilityHttpHandler(store, {
        assetRoot: DEFAULT_OBSERVABILITY_ASSET_ROOT,
        consoleClients,
        traceClients,
        traceSnapshot: observability.traceSnapshot,
      }),
    );
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      ipcMain.removeListener(
        GameConsoleIpc.rendererMessage.channel,
        handleRendererMessage,
      );
      unsubscribeAccounts();
      unsubscribeClosed();
      unsubscribeCreated();
      unsubscribeReloaded();
      unsubscribeTraces();
      closeSseClients(consoleClients);
      closeSseClients(traceClients);
      try {
        server.close();
      } catch {}
    };
    const installed = yield* Effect.tryPromise({
      try: () => startHttpServer(server, options.port),
      catch: (cause) =>
        new DesktopObservabilityServerStartError({
          cause,
          port: options.port,
        }),
    }).pipe(Effect.tapError(() => Effect.sync(cleanup)));

    console.info(
      `[observability] Desktop observability server listening on ${installed.url}`,
    );
    yield* observability.info(
      "observability-server",
      "Desktop observability server listening",
      {
        port: installed.port,
        url: installed.url,
      },
    );

    yield* Effect.addFinalizer(() => Effect.sync(cleanup));

    return installed;
  });

  return DesktopObservabilityServer.of({ install });
});

export const layer = Layer.effect(
  DesktopObservabilityServer,
  makeDesktopObservabilityServer,
);
