import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { Socket } from "net";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { makeDesktopHttpClient } from "./DesktopHttpClient";
const cleanups: (() => Promise<void>)[] = [];
const server = async (
  handle: (request: IncomingMessage, response: ServerResponse) => void,
) => {
  const instance = createServer(handle);
  const sockets = new Set<Socket>();
  instance.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        instance.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = instance.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP server");
  return new URL(`http://127.0.0.1:${address.port}/`);
};
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
describe("Desktop HTTP request lifecycle", () => {
  it.effect.each([303, 307])(
    "handles methods, bytes, and credentials across a %i redirect",
    (status) =>
      Effect.gen(function* () {
        const destination = yield* Effect.promise(() =>
          server((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () =>
              response.end(
                JSON.stringify({
                  method: request.method,
                  body: Buffer.concat(chunks).toString(),
                  authorization: request.headers.authorization,
                  contentType: request.headers["content-type"],
                }),
              ),
            );
          }),
        );
        const source = yield* Effect.promise(() =>
          server((_request, response) => {
            response.writeHead(status, { location: destination.href });
            response.end();
          }),
        );
        const result = yield* makeDesktopHttpClient().request({
          url: source,
          method: "POST",
          body: new Uint8Array(Buffer.from("!payload?")).subarray(1, -1),
          headers: { authorization: "secret", "content-type": "text/plain" },
        });
        expect(JSON.parse(result.body.toString())).toEqual({
          method: status === 303 ? "GET" : "POST",
          body: status === 303 ? "" : "payload",
          ...(status === 303 ? {} : { contentType: "text/plain" }),
        });
        expect(result.url).toBe(destination.href);
      }),
  );
  it.effect(
    "returns manual redirects and HTTP failures without following or failing them",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const url = yield* Effect.promise(() =>
          server((_request, response) => {
            calls += 1;
            response.writeHead(302, { location: "/elsewhere" });
            response.end("redirect");
          }),
        );
        const result = yield* makeDesktopHttpClient().request({
          url,
          redirect: "manual",
        });
        expect(result.statusCode).toBe(302);
        expect(result.body.toString()).toBe("redirect");
        expect(calls).toBe(1);
        const error = yield* makeDesktopHttpClient()
          .request({ url, redirect: "error" })
          .pipe(Effect.flip);
        expect(error.kind).toBe("redirect-failed");
      }),
  );
  it.effect(
    "rejects tunnels and protocol upgrades instead of leaving requests pending",
    () =>
      Effect.gen(function* () {
        const url = yield* Effect.promise(() =>
          server((_request, response) => {
            response.writeHead(101, {
              connection: "Upgrade",
              upgrade: "websocket",
            });
            response.end();
          }),
        );
        const http = makeDesktopHttpClient();
        expect(
          (yield* http.request({ url, method: "CONNECT" }).pipe(Effect.flip))
            .kind,
        ).toBe("request-failed");
        expect((yield* http.request({ url }).pipe(Effect.flip)).kind).toBe(
          "request-failed",
        );
      }),
  );
  it.effect(
    "interrupts the connection while the response body is still downloading",
    () =>
      Effect.gen(function* () {
        const started = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        const url = yield* Effect.promise(() =>
          server((_request, response) => {
            response.on("close", () => closed.resolve());
            response.write("partial");
            started.resolve();
          }),
        );
        const fiber = yield* Effect.forkChild(
          makeDesktopHttpClient().request({ url }),
        );
        yield* Effect.promise(() => started.promise);
        yield* Fiber.interrupt(fiber);
        yield* Effect.promise(() => closed.promise);
        expect(fiber.pollUnsafe()).toBeDefined();
      }),
  );
  it.effect(
    "uses one deadline across redirects and a partial response body",
    () =>
      Effect.gen(function* () {
        const first = Promise.withResolvers<ServerResponse>();
        const second = Promise.withResolvers<void>();
        const closed = Promise.withResolvers<void>();
        const url = yield* Effect.promise(() =>
          server((request, response) => {
            if (request.url === "/") first.resolve(response);
            else {
              response.on("close", () => closed.resolve());
              response.write("partial");
              second.resolve();
            }
          }),
        );
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const result = yield* Effect.forkChild(
          makeDesktopHttpClient()
            .request({ url, timeoutMs: 100 })
            .pipe(Effect.flip),
        );
        const response = yield* Effect.promise(() => first.promise);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(60));
        response.writeHead(302, { location: "/body" });
        response.end();
        yield* Effect.promise(() => second.promise);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(40));
        expect((yield* Fiber.join(result)).kind).toBe("timeout");
        yield* Effect.promise(() => closed.promise);
        expect(vi.getTimerCount()).toBe(0);
      }),
  );
  it.effect(
    "enforces streamed byte limits but does not treat HEAD content-length as a body",
    () =>
      Effect.gen(function* () {
        const url = yield* Effect.promise(() =>
          server((request, response) => {
            if (request.method === "HEAD") {
              response.writeHead(200, { "content-length": "9999999" });
              response.end();
            } else {
              response.write("1234");
              response.end("5678");
            }
          }),
        );
        const http = makeDesktopHttpClient();
        expect(
          (yield* http.request({ url, maxBytes: 4 }).pipe(Effect.flip)).kind,
        ).toBe("response-too-large");
        expect(
          (yield* http.request({ url, method: "HEAD", maxBytes: 4 })).body
            .byteLength,
        ).toBe(0);
      }),
  );
});
