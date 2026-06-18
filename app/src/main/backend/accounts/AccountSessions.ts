import type { ServerData } from "@lucent/game";
import { Effect, Layer, ServiceMap } from "effect";
import type {
  AccountGameLaunchPayload,
  AccountGameServerPingsResult,
  AccountScriptSession,
} from "../../../shared/ipc";

interface ShutdownRequest {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

export interface AccountServerCacheSnapshot {
  readonly servers: readonly ServerData[];
  readonly lastFetchTime: number;
  readonly lastRefreshRequestTime: number;
}

export interface AccountServerPingCacheSnapshot {
  readonly cacheKey: string;
  readonly result: AccountGameServerPingsResult;
}

type AccountRuntimeSession = AccountScriptSession;

export const mergeAccountSessionDisplayMetadata = (
  previous: AccountScriptSession | undefined,
  next: AccountScriptSession,
): AccountScriptSession => ({
  ...next,
  ...(next.launchUsername === undefined &&
  previous?.launchUsername !== undefined
    ? { launchUsername: previous.launchUsername }
    : {}),
  ...(next.currentUsername === undefined &&
  previous?.currentUsername !== undefined
    ? { currentUsername: previous.currentUsername }
    : {}),
});

export interface AccountSessionsShape {
  readonly getServerCache: () => AccountServerCacheSnapshot;
  readonly setCachedServers: (
    servers: readonly ServerData[],
    fetchedAt: number,
  ) => void;
  readonly getServerPingCache: () => AccountServerPingCacheSnapshot | null;
  readonly setCachedServerPings: (
    snapshot: AccountServerPingCacheSnapshot,
  ) => void;
  readonly resetServerPingCache: () => void;
  readonly resetServerFetchTime: () => void;
  readonly canRefreshServers: (now: number, cooldownMs: number) => boolean;
  readonly markServerRefreshRequest: (requestedAt: number) => void;
  readonly getServerRefreshAvailableAt: (cooldownMs: number) => number;
  readonly getSessionsState: () => readonly AccountScriptSession[];
  readonly getSession: (
    gameWindowId: number,
  ) => AccountScriptSession | undefined;
  readonly hasSession: (gameWindowId: number) => boolean;
  readonly upsertSession: (session: AccountRuntimeSession) => void;
  readonly deleteSession: (gameWindowId: number) => void;
  readonly getGameLaunchPayload: (
    gameWindowId: number,
  ) => AccountGameLaunchPayload | undefined;
  readonly setGameLaunchPayload: (
    gameWindowId: number,
    payload: AccountGameLaunchPayload,
  ) => void;
  readonly deleteGameLaunchPayload: (gameWindowId: number) => void;
  readonly registerShutdownRequest: (
    requestId: string,
    request: ShutdownRequest,
  ) => void;
  readonly deleteShutdownRequest: (requestId: string) => void;
  readonly resolveShutdownRequest: (requestId: string) => boolean;
  readonly rejectShutdownRequest: (requestId: string, error: Error) => boolean;
  readonly rejectAllShutdownRequests: (error: Error) => void;
}

export class AccountSessions extends ServiceMap.Service<
  AccountSessions,
  AccountSessionsShape
>()("main/backend/accounts/AccountSessions") {}

export const makeAccountSessions = (): AccountSessionsShape => {
  let lastServerRefreshRequestTime = 0;
  let cachedServers: ServerData[] = [];
  let lastServerFetchTime = 0;
  let cachedServerPings: AccountServerPingCacheSnapshot | null = null;
  const sessions = new Map<number, AccountScriptSession>();
  const gameLaunchPayloads = new Map<number, AccountGameLaunchPayload>();
  const pendingGameWindowShutdowns = new Map<string, ShutdownRequest>();

  const takeShutdownRequest = (
    requestId: string,
  ): ShutdownRequest | undefined => {
    const pending = pendingGameWindowShutdowns.get(requestId);
    if (!pending) {
      return undefined;
    }

    pendingGameWindowShutdowns.delete(requestId);
    pending.cleanup();
    return pending;
  };

  const rejectAllShutdownRequests = (error: Error): void => {
    for (const requestId of pendingGameWindowShutdowns.keys()) {
      const pending = takeShutdownRequest(requestId);
      pending?.reject(error);
    }
  };

  return {
    getServerCache: () => ({
      servers: cachedServers,
      lastFetchTime: lastServerFetchTime,
      lastRefreshRequestTime: lastServerRefreshRequestTime,
    }),
    setCachedServers: (servers, fetchedAt) => {
      cachedServers = [...servers];
      lastServerFetchTime = fetchedAt;
      cachedServerPings = null;
    },
    getServerPingCache: () => cachedServerPings,
    setCachedServerPings: (snapshot) => {
      cachedServerPings = snapshot;
    },
    resetServerPingCache: () => {
      cachedServerPings = null;
    },
    resetServerFetchTime: () => {
      lastServerFetchTime = 0;
    },
    canRefreshServers: (timestamp, cooldownMs) =>
      lastServerRefreshRequestTime === 0 ||
      timestamp - lastServerRefreshRequestTime >= cooldownMs,
    markServerRefreshRequest: (requestedAt) => {
      lastServerRefreshRequestTime = requestedAt;
    },
    getServerRefreshAvailableAt: (cooldownMs) =>
      lastServerRefreshRequestTime === 0
        ? 0
        : lastServerRefreshRequestTime + cooldownMs,
    getSessionsState: () => [...sessions.values()],
    getSession: (gameWindowId) => sessions.get(gameWindowId),
    hasSession: (gameWindowId) => sessions.has(gameWindowId),
    upsertSession: (session) => {
      sessions.set(session.gameWindowId, session);
    },
    deleteSession: (gameWindowId) => {
      sessions.delete(gameWindowId);
    },
    getGameLaunchPayload: (gameWindowId) =>
      gameLaunchPayloads.get(gameWindowId),
    setGameLaunchPayload: (gameWindowId, payload) => {
      gameLaunchPayloads.set(gameWindowId, payload);
    },
    deleteGameLaunchPayload: (gameWindowId) => {
      gameLaunchPayloads.delete(gameWindowId);
    },
    registerShutdownRequest: (requestId, request) => {
      pendingGameWindowShutdowns.set(requestId, request);
    },
    deleteShutdownRequest: (requestId) => {
      pendingGameWindowShutdowns.delete(requestId);
    },
    resolveShutdownRequest: (requestId) => {
      const pending = takeShutdownRequest(requestId);
      if (!pending) {
        return false;
      }

      pending.resolve();
      return true;
    },
    rejectShutdownRequest: (requestId, error) => {
      const pending = takeShutdownRequest(requestId);
      if (!pending) {
        return false;
      }

      pending.reject(error);
      return true;
    },
    rejectAllShutdownRequests,
  };
};

export const layer = Layer.effect(AccountSessions)(
  Effect.gen(function* () {
    const service = makeAccountSessions();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        service.rejectAllShutdownRequests(
          new Error("Account runtime service scope closed"),
        );
      }),
    );
    return service;
  }),
);
