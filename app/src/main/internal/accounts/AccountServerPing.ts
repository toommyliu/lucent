import { createConnection } from "net";
import { Schema } from "effect";

import type { AccountGameServerPing } from "@lucent/core/accounts";

export const ACCOUNT_SERVER_PING_CACHE_TTL_MS = 30_000;
const ACCOUNT_SERVER_PING_CONCURRENCY = 6;
const ACCOUNT_SERVER_PING_TIMEOUT_MS = 2_000;

export const AccountServerDataSchema = Schema.Struct({
  bOnline: Schema.Number,
  bUpg: Schema.Number,
  iChat: Schema.optionalKey(Schema.Number),
  iCount: Schema.Number,
  iLevel: Schema.optionalKey(Schema.Number),
  iMax: Schema.Number,
  iPort: Schema.Number,
  sIP: Schema.String,
  sLang: Schema.String,
  sName: Schema.String,
});

export type AccountServerData = typeof AccountServerDataSchema.Type;

interface AccountServerPingTarget {
  readonly serverName: string;
  readonly host: string;
  readonly port: number;
  readonly online: boolean;
}

interface AccountServerConnectLatencyOptions {
  readonly now: () => number;
  readonly timeoutMs: number;
}

type AccountServerConnectLatency = (
  target: AccountServerPingTarget,
  options: AccountServerConnectLatencyOptions,
) => Promise<number>;

class AccountServerPingTimeoutError extends Error {
  public constructor(serverName: string, timeoutMs: number) {
    super(`Timed out while pinging ${serverName} after ${timeoutMs}ms`);
    this.name = "AccountServerPingTimeoutError";
  }
}

export const accountServerPingCacheKey = (
  servers: readonly AccountServerData[],
): string =>
  servers
    .map(
      (server) =>
        `${server.sName}\0${server.bOnline}\0${server.sIP}\0${server.iPort}`,
    )
    .join("\n");

const toPingTarget = (server: AccountServerData): AccountServerPingTarget => ({
  serverName: server.sName,
  host: server.sIP,
  port: server.iPort,
  online: server.bOnline === 1,
});

const measureTcpConnectLatency: AccountServerConnectLatency = (
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

const pingAccountServer = async (
  target: AccountServerPingTarget,
): Promise<AccountGameServerPing> => {
  if (!target.online) {
    return {
      serverName: target.serverName,
      status: "offline",
    };
  }

  try {
    const latencyMs = await measureTcpConnectLatency(target, {
      now: Date.now,
      timeoutMs: ACCOUNT_SERVER_PING_TIMEOUT_MS,
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
  servers: readonly AccountServerData[],
): Promise<readonly AccountGameServerPing[]> => {
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
      pings[index] = await pingAccountServer(target);
    }
  };

  const workerCount = Math.min(ACCOUNT_SERVER_PING_CONCURRENCY, targets.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await worker();
    }),
  );

  return pings;
};
