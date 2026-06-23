import { createReadStream, promises as fs } from "fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { extname, resolve, sep } from "path";
import { Data, Effect, type Scope } from "effect";
import {
  isGameConsoleObservabilityRecord,
  isObservabilityConsoleMessageData,
} from "../../shared/observability";
import type {
  ObservabilityConsoleMessageData,
  ObservabilityRecord,
} from "../../shared/observability";
import type { AccountGameLaunchPayload } from "../../shared/ipc";
import type { AccountSessionsShape } from "../backend/accounts/AccountSessions";
import type { DesktopObservabilityShape } from "./DesktopObservability";

export const DEV_OBSERVABILITY_HOST = "127.0.0.1";
export const DEV_OBSERVABILITY_PORT = 17_683;

const API_CONSOLE_SNAPSHOT_PATH = "/api/observability/console/snapshot";
const API_CONSOLE_EVENTS_PATH = "/api/observability/console/events";
const API_CONSOLE_WINDOWS_PATH = "/api/observability/console/windows";
type ConsoleAccountMetadata = NonNullable<
  ObservabilityConsoleMessageData["account"]
>;
type ConsoleAccountMetadataCache = Map<string, ConsoleAccountMetadata | null>;

interface ConsoleWindowMetadata {
  readonly component: string;
  readonly account?: ConsoleAccountMetadata;
}

class DevObservabilityServerStartError extends Data.TaggedError(
  "DevObservabilityServerStartError",
)<{
  readonly cause: unknown;
}> {}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface DevObservabilityServerOptions {
  readonly accountSessions?: Pick<
    AccountSessionsShape,
    "getGameLaunchPayload" | "getGameWindowIdentity" | "getSession"
  >;
  readonly host?: string;
  readonly observability: Pick<
    DesktopObservabilityShape,
    "error" | "info" | "snapshot" | "subscribe"
  >;
  readonly port?: number;
  readonly rendererDir: string;
}

interface DevObservabilityServerRuntimeOptions extends DevObservabilityServerOptions {
  readonly accountMetadataByRecordKey?: ConsoleAccountMetadataCache;
}

const sendPlain = (
  response: ServerResponse,
  statusCode: number,
  message: string,
): void => {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(message);
};

const sendJson = (response: ServerResponse, data: unknown): void => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
};

const resolveStaticFilePath = (
  rendererRoot: string,
  pathname: string,
): string | null => {
  const root = resolve(rendererRoot);
  const routePath =
    pathname === "/"
      ? "/observability/index.html"
      : pathname === "/index.html" ||
          pathname === "/index.js" ||
          pathname === "/index.css" ||
          pathname === "/index.js.map" ||
          pathname === "/index.css.map"
        ? `/observability${pathname}`
        : pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(routePath);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) {
    return null;
  }

  const relativePath = decoded.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  return filePath === root || filePath.startsWith(`${root}${sep}`)
    ? filePath
    : null;
};

const serveStaticFile = async (
  response: ServerResponse,
  rendererRoot: string,
  pathname: string,
): Promise<void> => {
  const filePath = resolveStaticFilePath(rendererRoot, pathname);
  if (filePath === null) {
    sendPlain(response, 400, "Invalid path");
    return;
  }

  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    sendPlain(response, 404, "Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type":
      contentTypes[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath)
    .on("error", () => {
      if (!response.headersSent) {
        sendPlain(response, 500, "Failed to read file");
      } else {
        response.destroy();
      }
    })
    .pipe(response);
};

const parseGameWindowId = (component: string): number | null => {
  const match = /^game-window:(\d+)$/.exec(component);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
};

const consoleRecordKey = (record: ObservabilityRecord): string =>
  `${record.runId}:${record.id}`;

const equalsUsername = (left: string, right: string): boolean =>
  left.toLocaleLowerCase() === right.toLocaleLowerCase();

const resolveLaunchAccountMetadata = (
  payload: AccountGameLaunchPayload | undefined,
  launchUsername: string | undefined,
): ConsoleAccountMetadata | null => {
  if (launchUsername !== undefined && launchUsername !== "") {
    if (payload && equalsUsername(launchUsername, payload.account.username)) {
      return {
        label: payload.account.label,
        username: payload.account.username,
      };
    }

    return { label: launchUsername, username: launchUsername };
  }

  return payload
    ? {
        label: payload.account.label,
        username: payload.account.username,
      }
    : null;
};

const resolveConsoleAccountMetadata = (
  options: DevObservabilityServerRuntimeOptions,
  gameWindowId: number,
): ConsoleAccountMetadata | null => {
  const payload = options.accountSessions?.getGameLaunchPayload(gameWindowId);
  const identityUsername = options.accountSessions
    ?.getGameWindowIdentity(gameWindowId)
    ?.currentUsername.trim();
  const session = options.accountSessions?.getSession(gameWindowId);
  const currentUsername = session?.currentUsername?.trim();
  const launchUsername = session?.launchUsername?.trim();

  if (identityUsername !== undefined) {
    if (identityUsername === "") {
      return { label: "Logged out", username: "" };
    }

    if (payload && equalsUsername(identityUsername, payload.account.username)) {
      return {
        label: payload.account.label,
        username: payload.account.username,
      };
    }

    return { label: identityUsername, username: identityUsername };
  }

  if (currentUsername !== undefined) {
    if (currentUsername === "") {
      if (session?.status === "starting") {
        return resolveLaunchAccountMetadata(payload, launchUsername);
      }

      return { label: "Logged out", username: "" };
    }

    if (payload && equalsUsername(currentUsername, payload.account.username)) {
      return {
        label: payload.account.label,
        username: payload.account.username,
      };
    }

    return { label: currentUsername, username: currentUsername };
  }

  return resolveLaunchAccountMetadata(payload, launchUsername);
};

const annotateConsoleRecord = (
  options: DevObservabilityServerRuntimeOptions,
  record: ObservabilityRecord,
): ObservabilityRecord => {
  if (!isObservabilityConsoleMessageData(record.data)) {
    return record;
  }

  if (record.data.account !== undefined) {
    return record;
  }

  const gameWindowId = parseGameWindowId(record.component);
  if (gameWindowId === null) {
    return record;
  }

  const recordKey = consoleRecordKey(record);
  const cachedAccount = options.accountMetadataByRecordKey?.get(recordKey);
  const account =
    cachedAccount === undefined
      ? resolveConsoleAccountMetadata(options, gameWindowId)
      : cachedAccount;
  if (cachedAccount === undefined && account !== null) {
    options.accountMetadataByRecordKey?.set(recordKey, account);
  }

  if (account === null) {
    return record;
  }

  return {
    ...record,
    data: {
      ...record.data,
      account,
    },
  };
};

const consoleRecordsSnapshot = async (
  options: DevObservabilityServerRuntimeOptions,
): Promise<readonly ObservabilityRecord[]> => {
  const snapshot = await Effect.runPromise(options.observability.snapshot);
  return snapshot.records
    .filter(isGameConsoleObservabilityRecord)
    .map((record) => annotateConsoleRecord(options, record));
};

const consoleWindowMetadataSnapshot = async (
  options: DevObservabilityServerRuntimeOptions,
): Promise<readonly ConsoleWindowMetadata[]> => {
  const snapshot = await Effect.runPromise(options.observability.snapshot);
  const components = [
    ...new Set(
      snapshot.records
        .filter(isGameConsoleObservabilityRecord)
        .map((record) => record.component),
    ),
  ].toSorted();

  return components.map((component) => {
    const gameWindowId = parseGameWindowId(component);
    const account =
      gameWindowId === null
        ? null
        : resolveConsoleAccountMetadata(options, gameWindowId);
    if (account === null) {
      return { component };
    }

    return { account, component };
  });
};

const writeSseRecord = (
  response: ServerResponse,
  record: ObservabilityRecord,
): boolean =>
  response.write(
    `event: record\nid: ${record.runId}:${record.id}\ndata: ${JSON.stringify(record)}\n\n`,
  );

const serveConsoleEvents = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: DevObservabilityServerRuntimeOptions,
): Promise<void> => {
  response.writeHead(200, {
    "cache-control": "no-cache, no-store, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  response.write(": connected\n\n");
  response.flushHeaders();

  let writable = true;
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
    unsubscribe?.();
  };

  response.on("drain", () => {
    writable = true;
  });
  request.on("close", cleanup);

  heartbeat = setInterval(() => {
    if (!writable || response.destroyed || response.writableEnded) {
      return;
    }

    writable = response.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref?.();

  unsubscribe = await Effect.runPromise(
    options.observability.subscribe((record) => {
      if (
        closed ||
        !writable ||
        response.destroyed ||
        response.writableEnded ||
        !isGameConsoleObservabilityRecord(record)
      ) {
        return;
      }

      writable = writeSseRecord(
        response,
        annotateConsoleRecord(options, record),
      );
    }),
  );

  if (closed) {
    unsubscribe();
    return;
  }

  for (const record of await consoleRecordsSnapshot(options)) {
    if (closed || !writable || response.destroyed || response.writableEnded) {
      break;
    }

    writable = writeSseRecord(response, record);
  }
};

export const makeDevObservabilityRequestHandler = (
  options: DevObservabilityServerRuntimeOptions,
): ((request: IncomingMessage, response: ServerResponse) => void) => {
  return (request, response) => {
    void (async () => {
      if (request.method !== "GET") {
        sendPlain(response, 405, "Method not allowed");
        return;
      }

      const url = new URL(
        request.url ?? "/",
        `http://${options.host ?? DEV_OBSERVABILITY_HOST}`,
      );

      if (url.pathname === API_CONSOLE_SNAPSHOT_PATH) {
        sendJson(response, await consoleRecordsSnapshot(options));
        return;
      }

      if (url.pathname === API_CONSOLE_EVENTS_PATH) {
        await serveConsoleEvents(request, response, options);
        return;
      }

      if (url.pathname === API_CONSOLE_WINDOWS_PATH) {
        sendJson(response, await consoleWindowMetadataSnapshot(options));
        return;
      }

      await serveStaticFile(response, options.rendererDir, url.pathname);
    })().catch((cause: unknown) => {
      if (!response.headersSent) {
        sendPlain(response, 500, "Internal server error");
      } else {
        response.destroy();
      }
      void Effect.runPromise(
        options.observability.error(
          "observability-server",
          "Dev observability request failed",
          cause,
          { url: request.url },
        ),
      );
    });
  };
};

const listen = (server: Server, port: number, host: string): Promise<void> =>
  new Promise((resolveListen, rejectListen) => {
    const onError = (cause: Error) => {
      server.off("listening", onListening);
      rejectListen(cause);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolveClose) => {
    server.close(() => {
      resolveClose();
    });
  });

const logDevObservabilityServerReady = (url: string): void => {
  process.stdout.write(`[observability-server] running at ${url}\n`);
};

export const startDevObservabilityServer = (
  options: DevObservabilityServerOptions,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const host = options.host ?? DEV_OBSERVABILITY_HOST;
    const port = options.port ?? DEV_OBSERVABILITY_PORT;
    const url = `http://${host}:${port}/`;
    const runtimeOptions: DevObservabilityServerRuntimeOptions = {
      ...options,
      accountMetadataByRecordKey: new Map(),
    };
    const server = createServer(
      makeDevObservabilityRequestHandler(runtimeOptions),
    );

    const started = yield* Effect.tryPromise({
      try: () => listen(server, port, host),
      catch: (cause) => new DevObservabilityServerStartError({ cause }),
    }).pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          options.observability
            .error(
              "observability-server",
              "Dev observability server failed to start",
              cause.cause,
              { host, port, url },
            )
            .pipe(Effect.as(false)),
        onSuccess: () =>
          options.observability
            .info(
              "observability-server",
              "Dev observability web server running",
              { host, port, url },
            )
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  logDevObservabilityServerReady(url);
                }),
              ),
              Effect.as(true),
            ),
      }),
    );

    if (!started) {
      return;
    }

    const unsubscribe = yield* options.observability.subscribe((record) => {
      if (isGameConsoleObservabilityRecord(record)) {
        annotateConsoleRecord(runtimeOptions, record);
      }
    });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe();
      }).pipe(Effect.flatMap(() => Effect.promise(() => closeServer(server)))),
    );
  });
