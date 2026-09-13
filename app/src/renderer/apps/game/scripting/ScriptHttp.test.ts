import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import {
  HttpError,
  type DesktopHttpBridge,
  type HttpRequestPayload,
} from "../../../../shared/http";
import { HttpIpc } from "../../../../shared/ipc/http";
import type { IpcInvokeDescriptor } from "../../../../shared/ipc/core";
import { createDesktopIpcInvokeHandler } from "../../../../main/ipc/DesktopIpcInvoke";
import { createInvoke } from "../../../../main/preloadIpcClient";
import { makeScriptHttp } from "../../../../main/scripting/ScriptHttp";
import type { DesktopHttpClientShape } from "../../../../main/http/DesktopHttpClient";
import { makeScriptHttpApi } from "./ScriptHttp";
import { makeScriptAsyncScope } from "./scriptAsyncScope";
const bridgeMethod = <Payload, Result>(
  descriptor: IpcInvokeDescriptor<Payload, Result>,
  handle: (payload: Payload) => Effect.Effect<Result>,
) => {
  const handler = createDesktopIpcInvokeHandler(
    descriptor,
    handle,
    Effect.runPromise,
  );
  const invoke = createInvoke((_channel, payload) =>
    handler(undefined, payload),
  );
  return (payload: Payload) => invoke(descriptor, payload);
};
const setup = Effect.fn("TestHttp.setup")(function* (
  request: DesktopHttpClientShape["request"],
) {
  const main = makeScriptHttp({ request });
  const open = bridgeMethod(HttpIpc.openSession, () => main.openSession(1));
  const close = bridgeMethod(HttpIpc.closeSession, (payload) =>
    main.closeSession(1, payload.sessionId),
  );
  const cancel = bridgeMethod(HttpIpc.cancel, (payload) =>
    main.cancel(1, payload.sessionId, payload.requestId),
  );
  const bridge: DesktopHttpBridge = {
    openSession: () => open(undefined),
    closeSession: (sessionId) => close({ sessionId }),
    request: bridgeMethod(HttpIpc.request, (payload) =>
      main.request(1, payload),
    ),
    cancel: (sessionId, requestId) => cancel({ sessionId, requestId }),
  };
  const scope = makeScriptAsyncScope();
  yield* Effect.addFinalizer(() => scope.close);
  const http = yield* makeScriptHttpApi(bridge, scope);
  return { http, main, scope, bridge };
});
const response = (body: Uint8Array, statusCode = 200) => ({
  body: Buffer.from(body),
  headers: { "content-type": "application/json" },
  statusCode,
  statusMessage: "OK",
  url: "https://example.com/result",
});
describe("lucent/http", () => {
  it.effect(
    "runs lazily, normalizes bodies, and returns HTTP failures as readable responses",
    () =>
      Effect.gen(function* () {
        const calls: Parameters<DesktopHttpClientShape["request"]>[0][] = [];
        const { http, bridge } = yield* setup((input) =>
          Effect.sync(() => {
            calls.push(input);
            return response(input.body ?? new Uint8Array(), 422);
          }),
        );
        const openSession = vi.spyOn(bridge, "openSession");
        const request = http.request("https://example.com", {
          method: "post",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "invalid" }),
          timeout: Duration.seconds(15),
        });
        expect(calls).toHaveLength(0);
        expect(openSession).not.toHaveBeenCalled();
        const result = yield* request;
        expect(result.ok).toBe(false);
        expect(result.status).toBe(422);
        expect(result.headers.get("Content-Type")).toBe("application/json");
        expect(calls[0]?.method).toBe("POST");
        expect(calls[0]?.timeoutMs).toBeGreaterThan(0);
        expect(calls[0]?.timeoutMs).toBeLessThanOrEqual(15000);
        const read = result.json();
        expect(result.bodyUsed).toBe(false);
        expect(yield* read).toEqual({ error: "invalid" });
        expect(result.bodyUsed).toBe(true);
        expect((yield* result.text().pipe(Effect.flip)).reason).toBe("body");
        yield* request;
        expect(calls).toHaveLength(2);
        expect(openSession).toHaveBeenCalledTimes(1);
      }),
  );
  it.effect(
    "preserves binary view boundaries and form encoding across the IPC schema",
    () =>
      Effect.gen(function* () {
        const calls: Parameters<DesktopHttpClientShape["request"]>[0][] = [];
        const { http } = yield* setup((input) =>
          Effect.sync(() => {
            calls.push(input);
            return response(input.body ?? new Uint8Array());
          }),
        );
        const bytes = new Uint8Array([99, 0, 255, 98]).subarray(1, 3);
        const binary = yield* http.request("https://example.com", {
          method: "POST",
          body: bytes,
        });
        expect(new Uint8Array(yield* binary.arrayBuffer())).toEqual(
          new Uint8Array([0, 255]),
        );
        yield* http.request("https://example.com", {
          method: "POST",
          body: new URLSearchParams({ value: "a b" }),
        });
        expect(calls[1]?.headers?.["content-type"]).toBe(
          "application/x-www-form-urlencoded;charset=UTF-8",
        );
        expect(Buffer.from(calls[1]?.body ?? []).toString()).toBe("value=a+b");
      }),
  );
  it.effect(
    "consumes invalid JSON once and rejects invalid requests before transport",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const { http } = yield* setup(() =>
          Effect.sync(() => {
            calls += 1;
            return response(Buffer.from("invalid"));
          }),
        );
        const result = yield* http.request("https://example.com");
        const error = yield* result.json().pipe(Effect.flip);
        expect(error).toBeInstanceOf(http.HttpError);
        expect(error.cause).toBeInstanceOf(SyntaxError);
        expect(result.bodyUsed).toBe(true);
        for (const options of [
          { body: "no" },
          { timeout: -1 },
          { timeout: Number.NaN },
          { maxRedirects: -1 },
        ]) {
          expect(
            (yield* http
              .request("https://example.com", options)
              .pipe(Effect.flip)).reason,
          ).toBe("request");
        }
        expect(
          (yield* http
            .request("https://example.com", { timeout: 0 })
            .pipe(Effect.flip)).reason,
        ).toBe("timeout");
        expect(calls).toBe(1);
      }),
  );
  it.effect("applies a deadline when the caller omits timeout", () =>
    Effect.gen(function* () {
      const calls: Parameters<DesktopHttpClientShape["request"]>[0][] = [];
      const { http } = yield* setup((input) =>
        Effect.sync(() => {
          calls.push(input);
          return response(new Uint8Array());
        }),
      );
      yield* http.request("https://example.com");
      expect(calls[0]?.timeoutMs).toBeGreaterThan(0);
      expect(calls[0]?.timeoutMs).toBeLessThanOrEqual(20_000);
    }),
  );
  it.effect("honors cancellation before main registers a request", () =>
    Effect.gen(function* () {
      let transportCalls = 0;
      const { http, bridge } = yield* setup(() =>
        Effect.sync(() => {
          transportCalls += 1;
          return response(new Uint8Array());
        }),
      );
      const queued = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const completed =
        Promise.withResolvers<Awaited<ReturnType<typeof bridge.request>>>();
      const originalRequest = bridge.request;
      vi.spyOn(bridge, "request").mockImplementation(async (payload) => {
        queued.resolve();
        await release.promise;
        const result = await originalRequest(payload);
        completed.resolve(result);
        return result;
      });
      const controller = new AbortController();
      const fiber = yield* Effect.forkChild(
        http
          .request("https://example.com", { signal: controller.signal })
          .pipe(Effect.flip),
      );
      yield* Effect.promise(() => queued.promise);
      controller.abort();
      expect((yield* Fiber.join(fiber)).reason).toBe("aborted");
      release.resolve();
      expect(yield* Effect.promise(() => completed.promise)).toMatchObject({
        ok: false,
        error: { reason: "aborted" },
      });
      expect(transportCalls).toBe(0);
    }),
  );
  it.effect.each(["caller", "script", "effect"] as const)(
    "aborts main-process work when cancelled by %s",
    (source) =>
      Effect.gen(function* () {
        const started = Promise.withResolvers<AbortSignal>();
        const { http, scope } = yield* setup(() =>
          Effect.tryPromise({
            try: (signal) => {
              started.resolve(signal);
              return new Promise<ReturnType<typeof response>>(() => {});
            },
            catch: () => {
              throw new Error("Unexpected rejection");
            },
          }),
        );
        const controller = new AbortController();
        const fiber = yield* Effect.forkChild(
          http.request("https://example.com", { signal: controller.signal }),
        );
        const signal = yield* Effect.promise(() => started.promise);
        expect(signal.aborted).toBe(false);
        if (source === "caller") controller.abort();
        else if (source === "script") yield* scope.cancel;
        else yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(signal.aborted).toBe(true);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterrupts(exit.cause)).toBe(source !== "caller");
          if (source === "caller")
            expect(Cause.squash(exit.cause)).toMatchObject({
              reason: "aborted",
            });
        }
      }),
  );
  it.effect(
    "keeps session initialization usable when its first request is interrupted",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const { http, bridge } = yield* setup(() =>
          Effect.sync(() => {
            calls += 1;
            return response(new Uint8Array());
          }),
        );
        const opened = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const openSession = bridge.openSession;
        vi.spyOn(bridge, "openSession").mockImplementation(async () => {
          const id = await openSession();
          opened.resolve();
          await release.promise;
          return id;
        });
        const first = yield* Effect.forkChild(
          http.request("https://example.com/first"),
        );
        yield* Effect.promise(() => opened.promise);
        const second = yield* Effect.forkChild(
          http.request("https://example.com/second"),
        );
        const interrupted = yield* Effect.forkChild(Fiber.interrupt(first), {
          startImmediately: true,
        });
        release.resolve();
        yield* Fiber.join(interrupted);
        expect((yield* Fiber.join(second)).ok).toBe(true);
        expect(calls).toBe(1);
        expect(bridge.openSession).toHaveBeenCalledTimes(1);
      }),
  );
  it.effect(
    "isolates caller cancellation and releases remaining requests on renderer loss",
    () =>
      Effect.gen(function* () {
        const started = Promise.withResolvers<void>();
        const signals = new Map<string, AbortSignal>();
        const { http, main } = yield* setup(({ url }) =>
          Effect.tryPromise({
            try: (signal) => {
              signals.set(url.pathname, signal);
              if (signals.size === 2) started.resolve();
              return new Promise<ReturnType<typeof response>>(() => {});
            },
            catch: () => {
              throw new Error("Unexpected rejection");
            },
          }),
        );
        const controller = new AbortController();
        const first = yield* Effect.forkChild(
          http
            .request("https://example.com/first", { signal: controller.signal })
            .pipe(Effect.flip),
        );
        const second = yield* Effect.forkChild(
          http.request("https://example.com/second").pipe(Effect.flip),
        );
        yield* Effect.promise(() => started.promise);
        controller.abort();
        expect((yield* Fiber.join(first)).reason).toBe("aborted");
        expect(signals.get("/first")?.aborted).toBe(true);
        yield* main.closeRenderer(2);
        expect(signals.get("/second")?.aborted).toBe(false);
        yield* main.closeRenderer(1);
        expect((yield* Fiber.join(second)).reason).toBe("aborted");
        expect(signals.get("/second")?.aborted).toBe(true);
        expect(
          (yield* http.request("https://example.com/late").pipe(Effect.flip))
            .reason,
        ).toBe("aborted");
        expect(signals.size).toBe(2);
      }),
  );
  it.effect(
    "does not start work for an aborted caller and prevents closed-session reuse",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const { http, main } = yield* setup(() =>
          Effect.sync(() => {
            calls += 1;
            return response(new Uint8Array());
          }),
        );
        const controller = new AbortController();
        controller.abort();
        const error = yield* http
          .request("https://example.com", { signal: controller.signal })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(HttpError);
        expect(error.reason).toBe("aborted");
        const sessionId = yield* main.openSession(1);
        const payload: HttpRequestPayload = {
          sessionId,
          requestId: 1,
          url: "https://example.com",
          method: "GET",
          headers: {},
          redirect: "follow",
          maxRedirects: 5,
        };
        expect((yield* main.request(2, payload)).ok).toBe(false);
        yield* main.closeSession(1, sessionId);
        expect((yield* main.request(1, payload)).ok).toBe(false);
        expect(calls).toBe(0);
      }),
  );
});
