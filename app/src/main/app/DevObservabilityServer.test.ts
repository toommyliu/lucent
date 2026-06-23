import { createServer, get } from "http";
import type { AddressInfo } from "net";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { ObservabilityRecord } from "../../shared/observability";
import type { AccountScriptSession } from "../../shared/ipc";
import {
  makeDevObservabilityRequestHandler,
  startDevObservabilityServer,
} from "./DevObservabilityServer";
import type {
  AccountGameWindowIdentity,
  AccountSessionsShape,
} from "../backend/accounts/AccountSessions";
import type { DesktopObservabilityShape } from "./DesktopObservability";

const openServers: Array<ReturnType<typeof createServer>> = [];

const closeServer = (server: ReturnType<typeof createServer>): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });

const listen = (
  server: ReturnType<typeof createServer>,
): Promise<AddressInfo> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address() as AddressInfo);
    });
  });

const makeRecord = (
  id: number,
  input: Partial<ObservabilityRecord> = {},
): ObservabilityRecord => ({
  id,
  runId: "run-1",
  timestamp: "2026-05-22T12:00:00.000Z",
  level: "info",
  source: "game",
  component: "game-window:1",
  message: `record-${id}`,
  data: {
    kind: "console-message",
    consoleLevel: "info",
    electronLevel: 1,
    line: id,
    sourceId: "source.js",
  },
  ...input,
});

const makeFakeObservability = (
  initialRecords: readonly ObservabilityRecord[],
): Pick<
  DesktopObservabilityShape,
  "error" | "info" | "snapshot" | "subscribe"
> & {
  readonly errors: Array<{ readonly message: string; readonly data?: unknown }>;
  readonly infos: Array<{ readonly message: string; readonly data?: unknown }>;
  readonly listenerCount: () => number;
  readonly publish: (record: ObservabilityRecord) => void;
} => {
  const records = [...initialRecords];
  const listeners = new Set<(record: ObservabilityRecord) => void>();
  const errors: Array<{ readonly message: string; readonly data?: unknown }> =
    [];
  const infos: Array<{ readonly message: string; readonly data?: unknown }> =
    [];

  const appendRecord = (
    level: ObservabilityRecord["level"],
    component: string,
    message: string,
    data?: unknown,
  ): ObservabilityRecord => {
    const record = makeRecord(records.length + 1, {
      level,
      source: "main",
      component,
      message,
      ...(data === undefined ? {} : { data }),
    });
    records.push(record);
    return record;
  };

  return {
    errors,
    error: (component, message, _error, data) =>
      Effect.sync(() => {
        errors.push({ message, data });
        return appendRecord("error", component, message, data);
      }),
    info: (component, message, data) =>
      Effect.sync(() => {
        infos.push({ message, data });
        return appendRecord("info", component, message, data);
      }),
    infos,
    listenerCount: () => listeners.size,
    publish: (record) => {
      records.push(record);
      for (const listener of listeners) {
        listener(record);
      }
    },
    snapshot: Effect.sync(() => ({
      runId: "run-1",
      logPath: "/tmp/lucent-test.ndjson",
      records: [...records],
    })),
    subscribe: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
  };
};

const makeFakeAccountSessions = (options: {
  readonly accounts?: ReadonlyMap<
    number,
    { readonly label: string; readonly username: string }
  >;
  readonly identities?: ReadonlyMap<number, AccountGameWindowIdentity>;
  readonly sessions?: ReadonlyMap<number, AccountScriptSession>;
}): Pick<
  AccountSessionsShape,
  "getGameLaunchPayload" | "getGameWindowIdentity" | "getSession"
> => ({
  getGameLaunchPayload: (gameWindowId) => {
    const account = options.accounts?.get(gameWindowId);
    return account === undefined
      ? undefined
      : {
          account: {
            label: account.label,
            username: account.username,
            password: "secret",
          },
          gameWindowId,
          requestedAt: 0,
        };
  },
  getGameWindowIdentity: (gameWindowId) =>
    options.identities?.get(gameWindowId),
  getSession: (gameWindowId) => options.sessions?.get(gameWindowId),
});

const makeTestServer = async (
  observability: ReturnType<typeof makeFakeObservability>,
  options: {
    readonly accountSessions?: Pick<
      AccountSessionsShape,
      "getGameLaunchPayload" | "getGameWindowIdentity" | "getSession"
    >;
  } = {},
): Promise<{
  readonly baseUrl: string;
  readonly server: ReturnType<typeof createServer>;
}> => {
  const server = createServer(
    makeDevObservabilityRequestHandler({
      ...options,
      observability,
      rendererDir: "/tmp/lucent-renderer-test",
    }),
  );
  openServers.push(server);
  const address = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
};

describe("DevObservabilityServer", () => {
  afterEach(async () => {
    const servers = openServers.splice(0);
    await Promise.all(servers.map((server) => closeServer(server)));
  });

  it.effect("logs when the dev observability web server is running", () =>
    Effect.gen(function* () {
      const probe = createServer();
      openServers.push(probe);
      const address = yield* Effect.promise(() => listen(probe));
      yield* Effect.promise(() => closeServer(probe));
      openServers.splice(openServers.indexOf(probe), 1);
      const observability = makeFakeObservability([]);

      yield* Effect.scoped(
        startDevObservabilityServer({
          observability,
          port: address.port,
          rendererDir: "/tmp/lucent-renderer-test",
        }),
      );

      expect(observability.infos).toEqual([
        {
          message: "Dev observability web server running",
          data: {
            host: "127.0.0.1",
            port: address.port,
            url: `http://127.0.0.1:${address.port}/`,
          },
        },
      ]);
    }),
  );

  it("returns only annotated current-run game console records from the snapshot endpoint", async () => {
    const consoleRecord = makeRecord(1, { message: "console" });
    const lifecycleRecord = makeRecord(2, {
      data: { windowId: 1 },
      message: "Window observed",
    });
    const rendererRecord = makeRecord(3, {
      source: "renderer",
      message: "renderer console",
    });
    const observability = makeFakeObservability([
      consoleRecord,
      lifecycleRecord,
      rendererRecord,
    ]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        accounts: new Map([[1, { label: "Main Farmer", username: "hero" }]]),
      }),
    });

    const response = await fetch(
      `${baseUrl}/api/observability/console/snapshot`,
    );
    const records = (await response.json()) as readonly ObservabilityRecord[];

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(records).toEqual([
      {
        ...consoleRecord,
        data: {
          ...(consoleRecord.data as Record<string, unknown>),
          account: { label: "Main Farmer", username: "hero" },
        },
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  it("streams only matching console records over SSE", async () => {
    const observability = makeFakeObservability([]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        accounts: new Map([[1, { label: "Main Farmer", username: "hero" }]]),
      }),
    });
    const matchingRecord = makeRecord(1, { message: "live console" });

    const event = new Promise<string>((resolve, reject) => {
      const request = get(
        `${baseUrl}/api/observability/console/events`,
        (response) => {
          response.setEncoding("utf8");
          let body = "";
          response.on("data", (chunk: string) => {
            body += chunk;
            if (body.includes("event: record")) {
              resolve(body);
              request.destroy();
            }
          });
        },
      );
      request.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") {
          reject(error);
        }
      });
    });

    await vi.waitFor(() => {
      expect(observability.listenerCount()).toBe(1);
    });
    observability.publish(makeRecord(2, { data: { windowId: 1 } }));
    observability.publish(matchingRecord);

    await expect(event).resolves.toContain(
      JSON.stringify({
        ...matchingRecord,
        data: {
          ...(matchingRecord.data as Record<string, unknown>),
          account: { label: "Main Farmer", username: "hero" },
        },
      }),
    );
  });

  it("replays the current console snapshot when an SSE client connects", async () => {
    const snapshotRecord = makeRecord(1, { message: "from snapshot" });
    const observability = makeFakeObservability([snapshotRecord]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        accounts: new Map([[1, { label: "Main Farmer", username: "hero" }]]),
      }),
    });

    const event = new Promise<string>((resolve, reject) => {
      const request = get(
        `${baseUrl}/api/observability/console/events`,
        (response) => {
          response.setEncoding("utf8");
          let body = "";
          response.on("data", (chunk: string) => {
            body += chunk;
            if (body.includes("event: record")) {
              resolve(body);
              request.destroy();
            }
          });
        },
      );
      request.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") {
          reject(error);
        }
      });
    });

    await expect(event).resolves.toContain(
      JSON.stringify({
        ...snapshotRecord,
        data: {
          ...(snapshotRecord.data as Record<string, unknown>),
          account: { label: "Main Farmer", username: "hero" },
        },
      }),
    );
  });

  it("prefers current runtime username over the launch account after relogin", async () => {
    const consoleRecord = makeRecord(1, { message: "after relogin" });
    const observability = makeFakeObservability([consoleRecord]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        accounts: new Map([[1, { label: "Main Farmer", username: "hero" }]]),
        sessions: new Map([
          [
            1,
            {
              gameWindowId: 1,
              launchUsername: "hero",
              currentUsername: "alt",
              status: "running",
              updatedAt: 1,
            },
          ],
        ]),
      }),
    });

    const response = await fetch(
      `${baseUrl}/api/observability/console/snapshot`,
    );
    const records = (await response.json()) as readonly ObservabilityRecord[];

    expect(records).toEqual([
      {
        ...consoleRecord,
        data: {
          ...(consoleRecord.data as Record<string, unknown>),
          account: { label: "alt", username: "alt" },
        },
      },
    ]);
  });

  it("prefers live game window identity over launch metadata", async () => {
    const consoleRecord = makeRecord(1, { message: "after identity update" });
    const observability = makeFakeObservability([consoleRecord]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        accounts: new Map([[1, { label: "Main Farmer", username: "hero" }]]),
        identities: new Map([[1, { currentUsername: "alt", updatedAt: 2 }]]),
        sessions: new Map([
          [
            1,
            {
              gameWindowId: 1,
              launchUsername: "hero",
              currentUsername: "hero",
              status: "running",
              updatedAt: 1,
            },
          ],
        ]),
      }),
    });

    const response = await fetch(
      `${baseUrl}/api/observability/console/snapshot`,
    );
    const records = (await response.json()) as readonly ObservabilityRecord[];

    expect(records).toEqual([
      {
        ...consoleRecord,
        data: {
          ...(consoleRecord.data as Record<string, unknown>),
          account: { label: "alt", username: "alt" },
        },
      },
    ]);
  });

  it("annotates standalone game windows from live game window identity", async () => {
    const consoleRecord = makeRecord(1, {
      component: "game-window:42",
      message: "standalone",
    });
    const observability = makeFakeObservability([consoleRecord]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        identities: new Map([[42, { currentUsername: "solo", updatedAt: 1 }]]),
      }),
    });

    const response = await fetch(
      `${baseUrl}/api/observability/console/snapshot`,
    );
    const records = (await response.json()) as readonly ObservabilityRecord[];

    expect(records).toEqual([
      {
        ...consoleRecord,
        data: {
          ...(consoleRecord.data as Record<string, unknown>),
          account: { label: "solo", username: "solo" },
        },
      },
    ]);
  });

  it("returns current window account metadata without a new console record", async () => {
    const consoleRecord = makeRecord(1, { message: "before relogin" });
    const identities = new Map<number, AccountGameWindowIdentity>([
      [1, { currentUsername: "", updatedAt: 1 }],
    ]);
    const observability = makeFakeObservability([consoleRecord]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        identities,
      }),
    });

    const snapshotResponse = await fetch(
      `${baseUrl}/api/observability/console/snapshot`,
    );
    const snapshotRecords =
      (await snapshotResponse.json()) as readonly ObservabilityRecord[];
    expect(snapshotRecords[0]).toMatchObject({
      data: {
        account: { label: "Logged out", username: "" },
      },
    });

    identities.set(1, { currentUsername: "alt", updatedAt: 2 });

    const windowsResponse = await fetch(
      `${baseUrl}/api/observability/console/windows`,
    );
    const windows = (await windowsResponse.json()) as readonly unknown[];

    expect(windows).toEqual([
      {
        component: "game-window:1",
        account: { label: "alt", username: "alt" },
      },
    ]);
  });

  it("marks console records as logged out when runtime username is empty", async () => {
    const consoleRecord = makeRecord(1, { message: "after logout" });
    const observability = makeFakeObservability([consoleRecord]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        accounts: new Map([[1, { label: "Main Farmer", username: "hero" }]]),
        sessions: new Map([
          [
            1,
            {
              gameWindowId: 1,
              launchUsername: "hero",
              currentUsername: "",
              status: "running",
              updatedAt: 1,
            },
          ],
        ]),
      }),
    });

    const response = await fetch(
      `${baseUrl}/api/observability/console/snapshot`,
    );
    const records = (await response.json()) as readonly ObservabilityRecord[];

    expect(records).toEqual([
      {
        ...consoleRecord,
        data: {
          ...(consoleRecord.data as Record<string, unknown>),
          account: { label: "Logged out", username: "" },
        },
      },
    ]);
  });

  it("uses the launch account while a window is still signing in", async () => {
    const consoleRecord = makeRecord(1, { message: "during login" });
    const observability = makeFakeObservability([consoleRecord]);
    const { baseUrl } = await makeTestServer(observability, {
      accountSessions: makeFakeAccountSessions({
        accounts: new Map([[1, { label: "Main Farmer", username: "hero" }]]),
        sessions: new Map([
          [
            1,
            {
              gameWindowId: 1,
              launchUsername: "hero",
              currentUsername: "",
              status: "starting",
              updatedAt: 1,
            },
          ],
        ]),
      }),
    });

    const response = await fetch(
      `${baseUrl}/api/observability/console/snapshot`,
    );
    const records = (await response.json()) as readonly ObservabilityRecord[];

    expect(records).toEqual([
      {
        ...consoleRecord,
        data: {
          ...(consoleRecord.data as Record<string, unknown>),
          account: { label: "Main Farmer", username: "hero" },
        },
      },
    ]);
  });

  it.effect(
    "continues startup and logs an error when the fixed port is occupied",
    () =>
      Effect.gen(function* () {
        const blocker = createServer((_request, response) => {
          response.end("occupied");
        });
        openServers.push(blocker);
        const address = yield* Effect.promise(() => listen(blocker));
        const observability = makeFakeObservability([]);

        yield* Effect.scoped(
          startDevObservabilityServer({
            observability,
            port: address.port,
            rendererDir: "/tmp/lucent-renderer-test",
          }),
        );

        expect(observability.errors).toEqual([
          {
            message: "Dev observability server failed to start",
            data: expect.objectContaining({
              host: "127.0.0.1",
              port: address.port,
            }),
          },
        ]);
      }),
  );
});
