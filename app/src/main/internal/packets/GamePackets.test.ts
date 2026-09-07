import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";

import type { PacketsRequest } from "../../../shared/ipc/packets";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeGamePackets } from "./GamePackets";

describe("GamePackets", () => {
  it.effect("correlates responses with the requesting game and operation", () =>
    Effect.gen(function* () {
      const sent = yield* Ref.make<PacketsRequest | undefined>(undefined);
      const ipc = DesktopIpc.of({
        handle: () => Effect.void,
        sendToAll: () => Effect.void,
        sendToRendererIds: (_ids, _descriptor, payload) =>
          Ref.set(sent, payload as PacketsRequest),
      });
      const windows = {
        getOwnedRendererIds: () => Effect.succeed([]),
        isRendererReady: () => Effect.succeed(true),
        onClosed: () => Effect.succeed(() => undefined),
        onRendererDestroyed: () => Effect.succeed(() => undefined),
        onRendererReloaded: () => Effect.succeed(() => undefined),
        onRendererUnavailable: () => Effect.succeed(() => undefined),
      } as unknown as DesktopWindows["Service"];
      const packets = yield* makeGamePackets.pipe(
        Effect.provideService(DesktopIpc, ipc),
        Effect.provideService(DesktopWindows, windows),
      );

      const pending = yield* Effect.forkScoped(
        packets.request(42, {
          kind: "send",
          payload: {
            packet: "%xt%zm%retrieveUserDatas%-1%tommy%",
            target: "server-string",
          },
        }),
      );
      yield* Effect.yieldNow;
      const request = yield* Ref.get(sent);
      expect(request?.kind).toBe("send");

      yield* packets.respond(7, {
        ok: true,
        outcome: { kind: "send" },
        requestId: request!.requestId,
      });
      yield* Effect.yieldNow;
      expect(pending.pollUnsafe()).toBeUndefined();

      yield* packets.respond(42, {
        ok: true,
        outcome: { kind: "send" },
        requestId: request!.requestId,
      });

      expect(yield* Fiber.join(pending)).toEqual({ kind: "send" });
      const mismatched = yield* packets
        .request(42, { kind: "stop-queue" })
        .pipe(Effect.flip, Effect.forkScoped);
      yield* Effect.yieldNow;
      const next = yield* Ref.get(sent);
      yield* packets.respond(42, {
        ok: true,
        outcome: { kind: "send" },
        requestId: next!.requestId,
      });
      expect((yield* Fiber.join(mismatched)).message).toMatch(/returned/);
    }),
  );
});
