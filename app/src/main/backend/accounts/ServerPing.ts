import { createConnection } from "net";
import type { ServerData } from "@lucent/game";
import type { AccountGameServerPing } from "../../../shared/ipc";

export const ACCOUNT_SERVER_PING_CACHE_TTL_MS = 30_000;
export const ACCOUNT_SERVER_PING_CONCURRENCY = 6;
export const ACCOUNT_SERVER_PING_TIMEOUT_MS = 2_000;

export interface AccountServerPingTarget {
  readonly serverName: string;
  readonly host: string;
  readonly port: number;
  readonly online: boolean;
}

export interface AccountServerConnectLatencyOptions {
  readonly now: () => number;
  readonly timeoutMs: number;
}

export type AccountServerConnectLatency = (
  target: AccountServerPingTarget,
  options: AccountServerConnectLatencyOptions,
) => Promise<number>;

export interface AccountServerPingOptions {
  readonly concurrency?: number;
  readonly connectLatency?: AccountServerConnectLatency;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export class AccountServerPingTimeoutError extends Error {
  public constructor(serverName: string, timeoutMs: number) {
    super(`Timed out while pinging ${serverName} after ${timeoutMs}ms`);
    this.name = "AccountServerPingTimeoutError";
  }
}

export const accountServerPingCacheKey = (
  servers: readonly ServerData[],
): string =>
  servers
    .map(
      (server) =>
        `${server.sName}\0${server.bOnline}\0${server.sIP}\0${server.iPort}`,
    )
    .join("\n");

const toPingTarget = (server: ServerData): AccountServerPingTarget => ({
  serverName: server.sName,
  host: server.sIP,
  port: server.iPort,
  online: server.bOnline === 1,
});

const normalizeConcurrency = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return ACCOUNT_SERVER_PING_CONCURRENCY;
  }

  return Math.max(1, Math.trunc(value));
};

export const measureTcpConnectLatency: AccountServerConnectLatency = (
  target,
  options,
) =>
  new Promise((resolve, reject) => {
    const startedAt = options.now();
    let settled = false;
    let socket: ReturnType<typeof createConnection> | undefined;

    const settle = (complete: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (socket !== undefined) {
        socket.setTimeout(0);
        socket.removeListener("connect", handleConnect);
        socket.removeListener("error", handleError);
        socket.removeListener("timeout", handleTimeout);
        socket.destroy();
      }
      complete();
    };

    const handleConnect = (): void => {
      const latencyMs = Math.max(0, Math.round(options.now() - startedAt));
      settle(() => resolve(latencyMs));
    };

    const handleError = (error: Error): void => {
      settle(() => reject(error));
    };

    const handleTimeout = (): void => {
      settle(() =>
        reject(
          new AccountServerPingTimeoutError(
            target.serverName,
            options.timeoutMs,
          ),
        ),
      );
    };

    try {
      socket = createConnection({
        host: target.host,
        port: target.port,
      });
      socket.unref();
      socket.once("connect", handleConnect);
      socket.once("error", handleError);
      socket.once("timeout", handleTimeout);
      socket.setTimeout(options.timeoutMs);
    } catch (error) {
      settle(() => reject(error));
    }
  });

export const pingAccountServer = async (
  target: AccountServerPingTarget,
  options: Required<
    Pick<AccountServerPingOptions, "connectLatency" | "now" | "timeoutMs">
  >,
): Promise<AccountGameServerPing> => {
  if (!target.online) {
    return {
      serverName: target.serverName,
      status: "offline",
    };
  }

  try {
    const latencyMs = await options.connectLatency(target, {
      now: options.now,
      timeoutMs: options.timeoutMs,
    });
    return {
      latencyMs,
      serverName: target.serverName,
      status: "ok",
    };
  } catch (error) {
    return {
      serverName: target.serverName,
      status:
        error instanceof AccountServerPingTimeoutError
          ? "timeout"
          : "unreachable",
    };
  }
};

export const pingAccountServers = async (
  servers: readonly ServerData[],
  options: AccountServerPingOptions = {},
): Promise<readonly AccountGameServerPing[]> => {
  const concurrency = normalizeConcurrency(options.concurrency);
  const connectLatency = options.connectLatency ?? measureTcpConnectLatency;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? ACCOUNT_SERVER_PING_TIMEOUT_MS;
  const targets = servers.map(toPingTarget);
  const pings: AccountGameServerPing[] = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= targets.length) {
        return;
      }

      const target = targets[index]!;
      pings[index] = await pingAccountServer(target, {
        connectLatency,
        now,
        timeoutMs,
      });
    }
  };

  const workerCount = Math.min(concurrency, targets.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await worker();
    }),
  );

  return pings;
};
