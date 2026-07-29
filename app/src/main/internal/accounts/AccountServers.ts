import { get } from "https";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ACCOUNT_SERVER_REFRESH_COOLDOWN_MS } from "../../../shared/accountPolicy";
import type {
  AccountGameServer,
  AccountGameServerPingsResult,
  AccountGameServersResult,
} from "@lucent/core/accounts";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { DesktopObservability } from "../../app/DesktopObservability";
import {
  ACCOUNT_SERVER_PING_CACHE_TTL_MS,
  AccountServerDataSchema,
  accountServerPingCacheKey,
  pingAccountServers,
  type AccountServerData,
} from "./AccountServerPing";
import { AccountsError, accountError } from "./AccountsError";
import { getArtixLauncherRequestHeaders } from "../ArtixLauncher";

const SERVERS_API_URL = "https://game.aq.com/game/api/data/servers";
const SERVERS_CACHE_TTL_MS = 5 * 60 * 1_000;
const SERVER_REQUEST_TIMEOUT_MS = 10_000;

const decodeAccountServerDataList = Schema.decodeUnknownEffect(
  Schema.Array(AccountServerDataSchema),
);

interface AccountServerCache {
  readonly fetchedAt: number;
  readonly servers: readonly AccountServerData[];
}

interface AccountServerPingCache {
  readonly cacheKey: string;
  readonly result: AccountGameServerPingsResult;
}

const fetchJson = (
  url: string,
  headers: Record<string, string>,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const request = get(
      url,
      { headers: { Accept: "application/json", ...headers } },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        response.on("error", reject);
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const source = Buffer.concat(chunks).toString("utf8");
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Failed to fetch servers: ${statusCode} ${
                  response.statusMessage ?? ""
                }`.trim(),
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(source));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(SERVER_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Timed out while fetching servers"));
    });
    request.on("error", reject);
  });

const serverLoadErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  const statusCode = /Failed to fetch servers: (\d{3})/.exec(message)?.[1];
  return statusCode === undefined
    ? message || "Unable to load servers"
    : `Unable to load login servers (HTTP ${statusCode})`;
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
    const observability = yield* DesktopObservability;
    const requestHeaders = getArtixLauncherRequestHeaders(env.platform);
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

        const servers = yield* Effect.tryPromise({
          try: () => fetchJson(SERVERS_API_URL, requestHeaders),
          catch: (cause) =>
            accountError(
              "refresh-servers",
              serverLoadErrorMessage(cause),
              cause,
            ),
        }).pipe(
          Effect.flatMap(decodeAccountServerDataList),
          Effect.mapError((cause) =>
            cause instanceof AccountsError
              ? cause
              : accountError(
                  "refresh-servers",
                  "Invalid login servers payload",
                  cause,
                ),
          ),
          Effect.catch((error: AccountsError) =>
            serverCache === null
              ? Effect.fail(error)
              : observability
                  .warn("accounts", "Failed to fetch servers; using cache", {
                    error,
                    cachedServerCount: serverCache.servers.length,
                  })
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
