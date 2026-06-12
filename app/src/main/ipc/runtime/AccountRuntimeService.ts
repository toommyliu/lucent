import type { ServerData } from "@lucent/game";
import { Effect, Layer, ServiceMap } from "effect";
import type {
  AccountGameLaunchPayload,
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

type AccountRuntimeSession = AccountScriptSession & {
  readonly gameWindowId: number;
};

export interface AccountRuntimeServiceShape {
  readonly getServerCache: () => AccountServerCacheSnapshot;
  readonly setCachedServers: (
    servers: readonly ServerData[],
    fetchedAt: number,
  ) => void;
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
  readonly renameSessionUser: (
    fromUsername: string,
    toUsername: string,
    updatedAt: number,
  ) => void;
  readonly deleteSessionsByUsername: (username: string) => void;
  readonly getGameLaunchPayload: (
    gameWindowId: number,
  ) => AccountGameLaunchPayload | undefined;
  readonly setGameLaunchPayload: (
    gameWindowId: number,
    payload: AccountGameLaunchPayload,
  ) => void;
  readonly deleteGameLaunchPayload: (gameWindowId: number) => void;
  readonly getActiveUsername: (gameWindowId: number) => string | undefined;
  readonly registerShutdownRequest: (
    requestId: string,
    request: ShutdownRequest,
  ) => void;
  readonly deleteShutdownRequest: (requestId: string) => void;
  readonly resolveShutdownRequest: (requestId: string) => boolean;
  readonly rejectShutdownRequest: (requestId: string, error: Error) => boolean;
  readonly rejectAllShutdownRequests: (error: Error) => void;
}

export class AccountRuntimeService extends ServiceMap.Service<
  AccountRuntimeService,
  AccountRuntimeServiceShape
>()("main/ipc/runtime/AccountRuntimeService") {}

export const makeAccountRuntimeService = (): AccountRuntimeServiceShape => {
  let lastServerRefreshRequestTime = 0;
  let cachedServers: ServerData[] = [];
  let lastServerFetchTime = 0;
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
    renameSessionUser: (fromUsername, toUsername, updatedAt) => {
      for (const [gameWindowId, session] of sessions) {
        if (session.username === fromUsername) {
          sessions.set(gameWindowId, {
            ...session,
            username: toUsername,
            updatedAt,
          });
        }
      }
    },
    deleteSessionsByUsername: (username) => {
      for (const [gameWindowId, session] of sessions) {
        if (session.username === username) {
          sessions.delete(gameWindowId);
        }
      }
    },
    getGameLaunchPayload: (gameWindowId) =>
      gameLaunchPayloads.get(gameWindowId),
    setGameLaunchPayload: (gameWindowId, payload) => {
      gameLaunchPayloads.set(gameWindowId, payload);
    },
    deleteGameLaunchPayload: (gameWindowId) => {
      gameLaunchPayloads.delete(gameWindowId);
    },
    getActiveUsername: (gameWindowId) =>
      gameLaunchPayloads.get(gameWindowId)?.account.username ??
      sessions.get(gameWindowId)?.username,
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

export const AccountRuntimeServiceLive = Layer.effect(AccountRuntimeService)(
  Effect.gen(function* () {
    const service = makeAccountRuntimeService();
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
