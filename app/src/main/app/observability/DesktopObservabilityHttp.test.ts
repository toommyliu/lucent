import { ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { once } from "node:events";
import { vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { makeDesktopTraceBuffer } from "./DesktopTraceBuffer";
import { makeGameConsoleStore } from "./GameConsoleStore";
import {
  type SseClient,
  sseStream,
  startDesktopObservabilityHttpServer,
} from "./DesktopObservabilityHttp";

const decoder = new TextDecoder();

describe("desktop observability HTTP", () => {
  it.live(
    "serves read-only routes and streamed assets, then closes active SSE connections",
    () =>
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "lucent-observability-http-")),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        yield* Effect.promise(async () => {
          await mkdir(join(directory, "assets"));
          await writeFile(join(directory, "index.html"), "viewer");
          await writeFile(join(directory, "assets", "app.js"), "script");
        });
        const store = makeGameConsoleStore();
        store.openWindow(1);
        store.appendMessage({ gameWindowId: 1, message: "hello" });
        const consoleClients = new Set<SseClient>();
        const traceClients = new Set<SseClient>();
        let url = "";
        yield* Effect.scoped(
          Effect.gen(function* () {
            const installed = yield* startDesktopObservabilityHttpServer(
              store,
              {
                port: 0,
                assetRoot: directory,
                consoleClients,
                traceClients,
                traceSnapshot: makeDesktopTraceBuffer(new Date().toISOString())
                  .snapshot,
              },
            );
            url = installed.url;
            yield* Effect.promise(async () => {
              const home = await fetch(url);
              expect(home.headers.get("content-security-policy")).toContain(
                "default-src 'none'",
              );
              expect(home.headers.get("cache-control")).toBe("no-store");
              expect(await home.text()).toBe("viewer");
              expect(await (await fetch(`${url}/assets/app.js`)).text()).toBe(
                "script",
              );
              expect((await fetch(`${url}/assets/`)).status).toBe(404);
              expect(
                (await fetch(`${url}/assets/%2e%2e%2fpackage.json`)).status,
              ).toBe(404);
              expect((await fetch(`${url}/assets/missing`)).status).toBe(404);
              expect(
                (await fetch(`${url}/api/state`, { method: "POST" })).status,
              ).toBe(405);
              expect((await fetch(`${url}/missing`)).status).toBe(404);
              expect(
                await (
                  await fetch(`${url}/api/messages?windowId=1&q=hello`)
                ).json(),
              ).toMatchObject([{ message: "hello" }]);
              expect(
                await (
                  await fetch(`${url}/api/messages.ndjson?limit=0`)
                ).text(),
              ).toBe("");
              expect(await (await fetch(`${url}/health`)).json()).toMatchObject(
                { ok: true, activeGameWindowCount: 1 },
              );
              const response = await fetch(`${url}/trace-events`);
              expect(response.headers.get("content-type")).toContain(
                "text/event-stream",
              );
              const reader = response.body!.getReader();
              expect(decoder.decode((await reader.read()).value)).toContain(
                "event: snapshot",
              );
              expect(traceClients.size).toBe(1);
              // Leave the stream connected so scope shutdown must interrupt it.
            });
          }),
        );
        expect(traceClients.size).toBe(0);
        yield* Effect.promise(() => expect(fetch(url)).rejects.toThrow());
      }),
  );

  it.effect("replaces dropped trace deltas with the latest snapshot", () =>
    Effect.gen(function* () {
      const clients = new Set<SseClient>();
      const paused = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const chunks: string[] = [];
      let snapshot = 0;
      const consumer = yield* sseStream(clients, {
        event: "snapshot",
        read: () => snapshot,
      }).pipe(
        Stream.take(2),
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            chunks.push(decoder.decode(chunk));
            if (chunks.length === 1) {
              yield* Deferred.succeed(paused, undefined);
              yield* Deferred.await(resume);
            }
          }),
        ),
        Effect.forkScoped,
      );
      yield* Deferred.await(paused);
      const client = [...clients][0]!;
      for (let i = 1; i <= 1000; i++) {
        snapshot = i;
        client.publish("span", i);
      }
      yield* Deferred.succeed(resume, undefined);
      yield* Fiber.join(consumer);
      expect(chunks).toEqual([
        ": connected\n\nevent: snapshot\ndata: 0\n\n",
        "event: snapshot\ndata: 1000\n\n",
      ]);
      expect(clients.size).toBe(0);
    }),
  );

  it.effect("fails a console stream when its queue overflows", () =>
    Effect.gen(function* () {
      const clients = new Set<SseClient>();
      const paused = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const consumer = yield* sseStream(clients).pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(paused, undefined);
            yield* Deferred.await(resume);
          }),
        ),
        Effect.result,
        Effect.forkScoped,
      );
      yield* Deferred.await(paused);
      const client = [...clients][0]!;
      client.publish("message", "one");
      client.publish("message", "two");
      yield* Deferred.succeed(resume, undefined);
      expect(Result.isFailure(yield* Fiber.join(consumer))).toBe(true);
      expect(clients.size).toBe(0);
    }),
  );
});

it.live(
  "disconnects a backpressured HTTP console client without waiting for reads",
  () =>
    Effect.gen(function* () {
      const consoleClients = new Set<SseClient>();
      const traceClients = new Set<SseClient>();
      const installed = yield* startDesktopObservabilityHttpServer(
        makeGameConsoleStore(),
        {
          port: 0,
          assetRoot: "/tmp",
          consoleClients,
          traceClients,
          traceSnapshot: makeDesktopTraceBuffer(null).snapshot,
        },
      );
      yield* Effect.promise(async () => {
        let response: ServerResponse | undefined;
        const realWrite = ServerResponse.prototype.write;
        const spy = vi
          .spyOn(ServerResponse.prototype, "write")
          .mockImplementation(function (
            this: ServerResponse,
            ...args: unknown[]
          ) {
            response = this;
            return Reflect.apply(realWrite, this, args);
          });
        const socket = createConnection({
          host: "127.0.0.1",
          port: installed.port,
        });
        socket.on("error", () => {});
        socket.pause();
        try {
          await once(socket, "connect");
          socket.write(
            "GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n",
          );
          await vi.waitFor(() => expect(consoleClients.size).toBe(1));
          const client = [...consoleClients][0]!;
          let sent = 0;
          for (; sent < 256; sent++) {
            client.publish("message", "x".repeat(65536));
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (response?.writableNeedDrain) {
              await new Promise((resolve) => setTimeout(resolve, 50));
              if (response.writableNeedDrain) break;
            }
          }
          expect(response?.writableNeedDrain).toBe(true);
          client.publish("message", "queued");
          client.publish("message", "overflow");
          await vi.waitFor(() => expect(consoleClients.size).toBe(0));
          expect(response?.destroyed).toBe(true);
          expect((await fetch(installed.url + "/health")).status).toBe(200);
        } finally {
          socket.destroy();
          spy.mockRestore();
        }
      });
    }),
);
