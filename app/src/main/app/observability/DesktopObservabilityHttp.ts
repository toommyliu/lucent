import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import type { DesktopObservability } from "./DesktopObservability";
import {
  type GameConsoleMessageQuery,
  type GameConsoleStore,
  messagesToNdjson,
} from "./GameConsoleStore";

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

const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const json = (value: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(value, { status, headers });
const encoder = new TextEncoder();

interface SseSnapshot {
  readonly event: string;
  readonly read: () => unknown;
}
export interface SseClient {
  readonly close: () => void;
  readonly publish: (event: string, data: unknown) => void;
}
const ssePayload = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export const sseStream = (
  clients: Set<SseClient>,
  snapshot?: SseSnapshot,
  disconnect?: () => void,
) =>
  Stream.callback<() => string, Error>(
    (queue) =>
      Effect.gen(function* () {
        let needsSnapshot = false;
        const client: SseClient = {
          close: () => {
            Queue.endUnsafe(queue);
            disconnect?.();
          },
          publish: (event, data) => {
            const accepted = Queue.offerUnsafe(queue, () => {
              if (needsSnapshot && snapshot !== undefined) {
                needsSnapshot = false;
                return ssePayload(snapshot.event, snapshot.read());
              }
              return ssePayload(event, data);
            });
            if (!accepted) {
              if (snapshot === undefined) {
                Queue.failCauseUnsafe(
                  queue,
                  Cause.fail(new Error("Console event consumer fell behind.")),
                );
                disconnect?.();
              } else {
                needsSnapshot = true;
              }
            }
          },
        };
        clients.add(client);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            clients.delete(client);
          }),
        );
        Queue.offerUnsafe(
          queue,
          () =>
            ": connected\n\n" +
            (snapshot === undefined
              ? ""
              : ssePayload(snapshot.event, snapshot.read())),
        );
      }),
    { bufferSize: 1, strategy: "dropping" },
  ).pipe(Stream.map((read) => encoder.encode(read())));

export const publishSseEvent = (
  clients: Set<SseClient>,
  event: string,
  data: unknown,
): void => {
  for (const client of clients) client.publish(event, data);
};

export interface DesktopObservabilityHttpOptions {
  readonly assetRoot: string;
  readonly consoleClients: Set<SseClient>;
  readonly traceClients: Set<SseClient>;
  readonly traceSnapshot: DesktopObservability["Service"]["traceSnapshot"];
}

export const makeDesktopObservabilityHttpHandler = Effect.fn(
  "makeDesktopObservabilityHttpHandler",
)(function* (
  store: GameConsoleStore,
  options: DesktopObservabilityHttpOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const asset = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = observabilityAssetPath(
      options.assetRoot,
      new URL(request.url, "http://127.0.0.1"),
    );
    const assetHeaders = {
      ...headers,
      "content-security-policy": OBSERVABILITY_CONTENT_SECURITY_POLICY,
    };
    if (path === null)
      return HttpServerResponse.text("Not found", {
        status: 404,
        headers: assetHeaders,
      });
    return yield* fs.stat(path).pipe(
      Effect.flatMap((info) =>
        info.type === "File"
          ? HttpServerResponse.file(path, {
              headers: assetHeaders,
              contentType: contentTypeFor(path),
            })
          : Effect.succeed(
              HttpServerResponse.text("Not found", {
                status: 404,
                headers: assetHeaders,
              }),
            ),
      ),
      Effect.catch((error) =>
        Effect.succeed(
          HttpServerResponse.text(
            error.reason._tag === "NotFound" ||
              error.reason._tag === "BadResource"
              ? "Not found"
              : "Failed to read an observability viewer asset",
            {
              status:
                error.reason._tag === "NotFound" ||
                error.reason._tag === "BadResource"
                  ? 404
                  : 500,
              headers: assetHeaders,
            },
          ),
        ),
      ),
    );
  });
  const messages = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return store.queryMessages(
      parseMessageQuery(new URL(request.url, "http://127.0.0.1")),
    );
  });
  const events = (clients: Set<SseClient>, snapshot?: SseSnapshot) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const response = NodeHttpServerRequest.toServerResponse(request);
      return HttpServerResponse.stream(
        sseStream(clients, snapshot, () => response.destroy()),
        {
          headers: { ...headers, connection: "keep-alive" },
          contentType: "text/event-stream; charset=utf-8",
        },
      );
    });
  const app = yield* HttpRouter.toHttpEffect(
    HttpRouter.addAll([
      HttpRouter.route("GET", "/", asset),
      HttpRouter.route("GET", "/assets/*", asset),
      HttpRouter.route(
        "GET",
        "/api/messages",
        Effect.map(messages, (rows) => json(rows)),
      ),
      HttpRouter.route(
        "GET",
        "/api/messages.ndjson",
        Effect.map(messages, (rows) =>
          HttpServerResponse.text(messagesToNdjson(rows), {
            headers,
            contentType: "application/x-ndjson; charset=utf-8",
          }),
        ),
      ),
      HttpRouter.route(
        "GET",
        "/api/state",
        Effect.sync(() => json(store.state())),
      ),
      HttpRouter.route(
        "GET",
        "/api/traces",
        Effect.sync(() => json(options.traceSnapshot())),
      ),
      HttpRouter.route("GET", "/events", events(options.consoleClients)),
      HttpRouter.route(
        "GET",
        "/trace-events",
        events(options.traceClients, {
          event: "snapshot",
          read: options.traceSnapshot,
        }),
      ),
      HttpRouter.route(
        "GET",
        "/health",
        Effect.sync(() => {
          const state = store.state();
          return json({
            ok: true,
            activeGameWindowCount: state.activeGameWindowCount,
            buffer: state.buffer,
          });
        }),
      ),
      HttpRouter.route(
        "*",
        "/*",
        Effect.succeed(json({ error: "Not found" }, 404)),
      ),
    ]),
  );
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return request.method === "GET"
      ? yield* app
      : json({ error: "Method not allowed" }, 405);
  });
});

export const startDesktopObservabilityHttpServer = Effect.fn(
  "startDesktopObservabilityHttpServer",
)(function* (
  store: GameConsoleStore,
  options: DesktopObservabilityHttpOptions & { readonly port: number },
) {
  const server = createServer();
  const http = yield* NodeHttpServer.make(() => server, {
    port: options.port,
    host: "127.0.0.1",
    disablePreemptiveShutdown: true,
  });
  const app = yield* makeDesktopObservabilityHttpHandler(store, options);
  yield* http.serve(app);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const client of [...options.consoleClients, ...options.traceClients])
        client.close();
      server.closeAllConnections();
    }),
  );
  const port =
    http.address._tag === "TcpAddress" ? http.address.port : options.port;
  return { port, url: `http://127.0.0.1:${port}` };
}, Effect.provide(NodeHttpServer.layerHttpServices));
