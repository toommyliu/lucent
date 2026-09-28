import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as FileSystem from "effect/FileSystem";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
  HttpIncomingMessage,
} from "effect/unstable/http";

import { ACCOUNT_SERVER_REFRESH_COOLDOWN_MS } from "../../../shared/accountPolicy";
import type {
  AccountGameServer,
  AccountGameServerPingsResult,
  AccountGameServersResult,
} from "@lucent/core/accounts";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import {
  ACCOUNT_SERVER_PING_CACHE_TTL_MS,
  AccountServerDataSchema,
  accountServerPingCacheKey,
  pingAccountServers,
  type AccountServerData,
} from "./AccountServerPing";
import { AccountsError, accountError } from "./AccountsError";
import { getGameRequestHeaders } from "../GameRequestHeaders";

const SERVERS_API_URL = "https://game.aq.com/game/api/data/servers";
const SERVERS_CACHE_TTL_MS = 5 * 60 * 1_000;
const SERVER_REQUEST_TIMEOUT_MS = 10_000;

export const requestAccountServers = Effect.fn("requestAccountServers")(
  function* (
    client: HttpClient.HttpClient,
    url: string,
    headers: Record<string, string>,
  ) {
    const response = yield* HttpClient.withScope(
      HttpClient.filterStatusOk(client),
    ).get(url, { headers: { Accept: "application/json", ...headers } });
    return yield* HttpClientResponse.schemaBodyJson(
      Schema.Array(AccountServerDataSchema),
    )(response);
  },
  Effect.provideService(
    HttpIncomingMessage.MaxBodySize,
    FileSystem.Size(1024 * 1024),
  ),
  Effect.timeout(SERVER_REQUEST_TIMEOUT_MS),
  Effect.scoped,
);

interface AccountServerCache {
  readonly fetchedAt: number;
  readonly servers: readonly AccountServerData[];
}

interface AccountServerPingCache {
  readonly cacheKey: string;
  readonly result: AccountGameServerPingsResult;
}

const serverLoadErrorMessage = (error: unknown): string => {
  if (
    HttpClientError.isHttpClientError(error) &&
    error.reason._tag === "StatusCodeError"
  ) {
    return `Unable to load login servers (HTTP ${error.reason.response.status})`;
  }
  return error instanceof Error ? error.message : "Unable to load servers";
};

const toAccountGameServer = (server: AccountServerData): AccountGameServer => ({
  name: server.sName,
  language: server.sLang,
  online: server.bOnline === 1,
  upgrade: server.bUpg === 1,
  playerCount: server.iCount,
  maxPlayers: server.iMax,
});

export interface AccountServersShape {
  readonly get: Effect.Effect<AccountGameServersResult, AccountsError>;
  readonly getPings: Effect.Effect<AccountGameServerPingsResult, AccountsError>;
  readonly refresh: Effect.Effect<AccountGameServersResult, AccountsError>;
}

export class AccountServers extends Context.Service<
  AccountServers,
  AccountServersShape
>()("lucent/internal/accounts/AccountServers") {}

export const layer = Layer.effect(
  AccountServers,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const client = yield* HttpClient.HttpClient;
    const requestHeaders = getGameRequestHeaders(env.platform);
    const serverLoads = yield* Semaphore.make(1);
    const pingLoads = yield* Semaphore.make(1);
    let serverCache: AccountServerCache | null = null;
    let serverPingCache: AccountServerPingCache | null = null;
    let lastRefreshRequestTime = 0;

    const getCachedServers = serverLoads.withPermits(1)(
      Effect.gen(function* () {
        const timestamp = Date.now();
        if (
          serverCache !== null &&
          timestamp - serverCache.fetchedAt < SERVERS_CACHE_TTL_MS
        ) {
          return serverCache.servers;
        }

        const servers = yield* requestAccountServers(
          client,
          SERVERS_API_URL,
          requestHeaders,
        ).pipe(
          Effect.mapError((cause) =>
            accountError(
              "refresh-servers",
              cause._tag === "SchemaError"
                ? "Invalid login servers payload"
                : serverLoadErrorMessage(cause),
              cause,
            ),
          ),
          Effect.catch((error: AccountsError) =>
            serverCache === null
              ? Effect.fail(error)
              : Effect.logWarning("Failed to fetch servers; using cache")
                  .pipe(
                    Effect.annotateLogs({
                      component: "accounts",
                      data: {
                        error,
                        cachedServerCount: serverCache.servers.length,
                      },
                    }),
                  )
                  .pipe(Effect.as(serverCache.servers)),
          ),
        );

        serverCache = { fetchedAt: Date.now(), servers };
        serverPingCache = null;
        return servers;
      }),
    );

    const toResult = (
      servers: readonly AccountServerData[],
    ): AccountGameServersResult => ({
      servers: servers.map(toAccountGameServer),
      refreshAvailableAt:
        lastRefreshRequestTime === 0
          ? 0
          : lastRefreshRequestTime + ACCOUNT_SERVER_REFRESH_COOLDOWN_MS,
    });

    const get: AccountServersShape["get"] = getCachedServers.pipe(
      Effect.map(toResult),
    );

    const getPings: AccountServersShape["getPings"] = pingLoads.withPermits(1)(
      Effect.gen(function* () {
        const servers = yield* getCachedServers;
        const cacheKey = accountServerPingCacheKey(servers);
        const timestamp = Date.now();
        if (
          serverPingCache !== null &&
          serverPingCache.cacheKey === cacheKey &&
          timestamp < serverPingCache.result.expiresAt
        ) {
          return serverPingCache.result;
        }

        const pings = yield* Effect.tryPromise({
          try: () => pingAccountServers(servers),
          catch: (cause) =>
            accountError(
              "refresh-servers",
              serverLoadErrorMessage(cause),
              cause,
            ),
        });
        const measuredAt = Date.now();
        const result: AccountGameServerPingsResult = {
          expiresAt: measuredAt + ACCOUNT_SERVER_PING_CACHE_TTL_MS,
          measuredAt,
          pings,
        };
        serverPingCache = { cacheKey, result };
        return result;
      }),
    );

    const refresh: AccountServersShape["refresh"] = Effect.gen(function* () {
      const timestamp = Date.now();
      if (
        lastRefreshRequestTime !== 0 &&
        timestamp - lastRefreshRequestTime < ACCOUNT_SERVER_REFRESH_COOLDOWN_MS
      ) {
        return yield* get;
      }

      lastRefreshRequestTime = timestamp;
      serverCache = null;
      serverPingCache = null;
      return toResult(yield* getCachedServers);
    });

    return AccountServers.of({ get, getPings, refresh });
  }),
);
