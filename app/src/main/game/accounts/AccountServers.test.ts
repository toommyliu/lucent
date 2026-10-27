import { createServer } from "node:http";
import { afterEach, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import {
  AccountServers,
  layer as serversLayer,
  requestAccountServers,
} from "./AccountServers";
import { layer as environmentLayer } from "../../app/DesktopEnvironment";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

const serve = (body: string, status = 200) =>
  Effect.promise(async () => {
    const server = createServer((_request, response) => {
      response.writeHead(status);
      response.end(body);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Expected TCP address");
    return `http://127.0.0.1:${address.port}`;
  });

layer(NodeHttpClient.layerNodeHttp)("account server requests", (it) => {
  it.effect("decodes server data and retains typed HTTP failures", () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const value = {
        bOnline: 1,
        bUpg: 0,
        iCount: 10,
        iMax: 1000,
        iPort: 5588,
        sIP: "game.aq.com",
        sLang: "en",
        sName: "Artix",
      };
      expect(
        yield* requestAccountServers(
          client,
          yield* serve(JSON.stringify([value])),
          {},
        ),
      ).toEqual([value]);
      const error = yield* requestAccountServers(
        client,
        yield* serve("unavailable", 503),
        {},
      ).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "HttpClientError",
        reason: { _tag: "StatusCodeError", response: { status: 503 } },
      });
    }),
  );
  it.effect("rejects oversized and invalid server lists", () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const oversized = yield* requestAccountServers(
        client,
        yield* serve(" ".repeat(1024 * 1024 + 1)),
        {},
      ).pipe(Effect.flip);
      expect(oversized).toMatchObject({
        _tag: "HttpClientError",
        reason: { _tag: "DecodeError" },
      });
      const invalid = yield* requestAccountServers(
        client,
        yield* serve('[{"sName":"incomplete"}]'),
        {},
      ).pipe(Effect.flip);
      expect(invalid._tag).toBe("SchemaError");
    }),
  );
});

it.effect("keeps cached servers after a manual refresh fails", () => {
  let requests = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests += 1;
      return HttpClientResponse.fromWeb(
        request,
        requests === 1
          ? new Response(
              JSON.stringify([
                {
                  bOnline: 0,
                  bUpg: 0,
                  iCount: 10,
                  iMax: 1000,
                  iPort: 5588,
                  sIP: "game.aq.com",
                  sLang: "en",
                  sName: "Artix",
                },
              ]),
            )
          : new Response("unavailable", { status: 503 }),
      );
    }),
  );
  return Effect.gen(function* () {
    const accounts = yield* AccountServers;
    const expectedServers = [
      {
        name: "Artix",
        language: "en",
        online: false,
        upgrade: false,
        playerCount: 10,
        maxPlayers: 1000,
      },
    ];
    expect(yield* accounts.get).toEqual({
      servers: expectedServers,
      refreshAvailableAt: 0,
    });
    yield* TestClock.adjust(15_000);
    const refreshed = yield* accounts.refresh.pipe(Effect.exit);
    expect(yield* accounts.get).toEqual({
      servers: expectedServers,
      refreshAvailableAt: 30_000,
    });
    expect(refreshed).toEqual(
      Exit.succeed({ servers: expectedServers, refreshAvailableAt: 30_000 }),
    );
    expect(yield* accounts.getPings).toEqual({
      pings: [{ serverName: "Artix", status: "offline" }],
    });
    expect(yield* accounts.refresh).toEqual({
      servers: expectedServers,
      refreshAvailableAt: 30_000,
    });
    expect(requests).toBe(2);
  }).pipe(
    Effect.provide(
      serversLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, client),
            environmentLayer({
              appDataDir: "/tmp/lucent-servers",
              assetsDir: "/tmp/lucent-servers/assets",
              workspaceDir: "/tmp/lucent-servers/workspace",
              isDev: false,
              platform: process.platform,
            }),
          ),
        ),
      ),
    ),
  );
});
