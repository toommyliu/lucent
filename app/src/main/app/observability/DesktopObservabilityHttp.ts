import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Effect from "effect/Effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  type GameConsoleMessageQuery,
  type GameConsoleStore,
  messagesToNdjson,
} from "./GameConsoleStore";

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

const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const json = (value: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(value, { status, headers });

export const makeDesktopObservabilityHttpHandler = Effect.fn(
  "makeDesktopObservabilityHttpHandler",
)(function* (store: GameConsoleStore) {
  const messages = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return store.queryMessages(
      parseMessageQuery(new URL(request.url, "http://127.0.0.1")),
    );
  });
  const app = yield* HttpRouter.toHttpEffect(
    HttpRouter.addAll([
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
)(function* (store: GameConsoleStore, options: { readonly port: number }) {
  const server = createServer();
  const http = yield* NodeHttpServer.make(() => server, {
    port: options.port,
    host: "127.0.0.1",
    disablePreemptiveShutdown: true,
  });
  const app = yield* makeDesktopObservabilityHttpHandler(store);
  yield* http.serve(app);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      server.closeAllConnections();
    }),
  );
  const port =
    http.address._tag === "TcpAddress" ? http.address.port : options.port;
  return { port, url: `http://127.0.0.1:${port}` };
});
