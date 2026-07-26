import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";

import type { DesktopPacketsBridge } from "../../../shared/desktopBridge";
import type {
  PacketsRequest,
  PacketsResponse,
} from "../../../shared/ipc/packets";
import { Api, type ApiService } from "./flash";
import { installPacketsBridge } from "./packetsBridge";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("packets bridge", () => {
  it.effect("delays only between queued packet sends", () => {
    const sends: Array<{ readonly at: number; readonly packet: string }> = [];
    const api = {
      events: {
        on: () => Effect.succeed(() => undefined),
      },
      packet: {
        sendClient: () => Effect.succeed(true),
        sendServer: (packet: string) =>
          Effect.sync(() => {
            sends.push({ at: Date.now(), packet });
            return true;
          }),
      },
    } as unknown as ApiService;

    return Effect.gen(function* () {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);

      const context = yield* Effect.context<Api>();
      const runtime = {
        runPromise: Effect.runPromiseWith(context),
      } as unknown as Parameters<typeof installPacketsBridge>[0];

      let requestListener: ((request: PacketsRequest) => void) | undefined;
      let resolveResponse: ((response: PacketsResponse) => void) | undefined;
      const response = new Promise<PacketsResponse>((resolve) => {
        resolveResponse = resolve;
      });
      const bridge = {
        onRequest: (listener: (request: PacketsRequest) => void) => {
          requestListener = listener;
          return () => {
            requestListener = undefined;
          };
        },
        publishStatus: async () => undefined,
        respond: async (payload: PacketsResponse) => {
          resolveResponse?.(payload);
        },
      } as unknown as DesktopPacketsBridge;
      vi.stubGlobal("window", { desktop: { packets: bridge } });

      const controller = installPacketsBridge(runtime);
      requestListener?.({
        kind: "start-queue",
        payload: {
          delayMs: 1_000,
          packets: ["first", "second"],
          target: "server-string",
        },
        requestId: "start-queue",
      });
      yield* Effect.promise(() => response);

      expect(sends).toEqual([{ at: 1_000, packet: "first" }]);

      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(999));
      expect(sends).toHaveLength(1);

      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
      expect(sends).toEqual([
        { at: 1_000, packet: "first" },
        { at: 2_000, packet: "second" },
      ]);

      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1_000));
      expect(sends).toEqual([
        { at: 1_000, packet: "first" },
        { at: 2_000, packet: "second" },
        { at: 3_000, packet: "first" },
      ]);

      controller.dispose();
    }).pipe(Effect.provideService(Api, api));
  });
});
