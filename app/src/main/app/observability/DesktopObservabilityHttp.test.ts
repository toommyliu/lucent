import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeGameConsoleStore } from "./GameConsoleStore";
import { startDesktopObservabilityHttpServer } from "./DesktopObservabilityHttp";

describe("desktop observability HTTP", () => {
  it.live("serves read-only routes, then stops listening on shutdown", () =>
    Effect.gen(function* () {
      const store = makeGameConsoleStore();
      store.openWindow(1);
      store.appendMessage({ gameWindowId: 1, message: "hello" });
      let url = "";
      yield* Effect.scoped(
        Effect.gen(function* () {
          const installed = yield* startDesktopObservabilityHttpServer(store, {
            port: 0,
          });
          url = installed.url;
          yield* Effect.promise(async () => {
            const messages = await fetch(
              `${url}/api/messages?windowId=1&q=hello`,
            );
            expect(messages.headers.get("cache-control")).toBe("no-store");
            expect(await messages.json()).toMatchObject([{ message: "hello" }]);
            expect(
              await (await fetch(`${url}/api/messages.ndjson?limit=0`)).text(),
            ).toBe("");
            expect(await (await fetch(`${url}/health`)).json()).toMatchObject({
              ok: true,
              activeGameWindowCount: 1,
            });
            expect(
              (await fetch(`${url}/api/state`, { method: "POST" })).status,
            ).toBe(405);
            expect((await fetch(url)).status).toBe(404);
            expect((await fetch(`${url}/api/traces`)).status).toBe(404);
          });
        }),
      );
      yield* Effect.promise(() => expect(fetch(url)).rejects.toThrow());
    }),
  );
});
