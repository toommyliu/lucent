import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import type { FlashPacket, PacketSelector } from "../Types";
import type {
  FlashPacketHandler,
  FlashProtocolShape,
} from "../protocol/FlashProtocol";
import { matchesPacketSelector } from "../protocol/PacketSelectors";
import { observePacketDuring } from "./ActionVerification";

const responsePacket = (
  itemId = 7,
): Extract<FlashPacket, { readonly direction: "extension" }> => ({
  command: "getDrop",
  data: { ItemID: itemId, bSuccess: true },
  direction: "extension",
  raw: "",
  wireType: "json",
});

const makePacketPort = () => {
  let handler: FlashPacketHandler | undefined;
  let selector: PacketSelector | undefined;
  let disposeCount = 0;
  const onPacket: FlashProtocolShape["onPacket"] = (nextSelector, next) =>
    Effect.sync(() => {
      handler = next;
      selector = nextSelector;
      return () => {
        disposeCount += 1;
        if (handler === next) {
          handler = undefined;
        }
      };
    });

  return {
    disposeCount: () => disposeCount,
    emit: (packet: FlashPacket) =>
      handler === undefined || selector === undefined
        ? Effect.die(new Error("Packet listener was not registered"))
        : matchesPacketSelector(packet, selector)
          ? handler(packet)
          : Effect.void,
    hasListener: () => handler !== undefined,
    protocol: { onPacket },
    selector: () => selector,
  };
};

describe("observePacketDuring", () => {
  it.effect("registers before dispatch and disposes after a match", () =>
    Effect.gen(function* () {
      const port = makePacketPort();
      const packet = responsePacket();
      const selector = {
        command: "getDrop",
        direction: "extension",
        wireType: "json",
      } as const;

      const result = yield* observePacketDuring(
        port.protocol,
        selector,
        () => true,
        Effect.gen(function* () {
          expect(port.hasListener()).toBe(true);
          yield* port.emit({ ...packet, direction: "server" });
          yield* port.emit(packet);
          return "sent";
        }),
      );

      expect(result).toEqual({ actionResult: "sent", packet });
      expect(port.selector()).toEqual(selector);
      expect(port.disposeCount()).toBe(1);
      expect(port.hasListener()).toBe(false);
    }),
  );

  it.effect("disposes after failure, timeout, and a skipped wait", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failedPort = makePacketPort();
        const error = yield* observePacketDuring(
          failedPort.protocol,
          { command: "getDrop" },
          () => true,
          Effect.fail("dispatch failed"),
        ).pipe(Effect.flip);
        expect(error).toBe("dispatch failed");
        expect(failedPort.disposeCount()).toBe(1);

        const timedOutPort = makePacketPort();
        const timedOut = yield* observePacketDuring(
          timedOutPort.protocol,
          { command: "getDrop" },
          () => true,
          Effect.succeed(true),
          { timeout: 0 },
        );
        expect(timedOut).toEqual({ actionResult: true, packet: null });
        expect(timedOutPort.disposeCount()).toBe(1);

        const skippedPort = makePacketPort();
        const skipped = yield* observePacketDuring(
          skippedPort.protocol,
          { command: "getDrop" },
          () => true,
          Effect.succeed(false),
          { shouldAwait: (sent) => sent },
        );
        expect(skipped).toEqual({ actionResult: false, packet: null });
        expect(skippedPort.disposeCount()).toBe(1);

        const registered = yield* Deferred.make<void>();
        const finishAcquire = yield* Deferred.make<void>();
        let interruptedHandler: FlashPacketHandler | undefined;
        let interruptedDisposeCount = 0;
        const interruptedProtocol = {
          onPacket: (
            _selector: PacketSelector | undefined,
            handler: FlashPacketHandler,
          ) =>
            Effect.gen(function* () {
              interruptedHandler = handler;
              yield* Deferred.succeed(registered, undefined);
              yield* Deferred.await(finishAcquire);
              return () => {
                interruptedDisposeCount += 1;
                interruptedHandler = undefined;
              };
            }),
        } satisfies Pick<FlashProtocolShape, "onPacket">;
        const observation = yield* observePacketDuring(
          interruptedProtocol,
          { command: "getDrop" },
          () => true,
          Effect.never,
        ).pipe(Effect.forkScoped);
        yield* Deferred.await(registered);
        const interruption = yield* Fiber.interrupt(observation).pipe(
          Effect.forkScoped,
        );
        yield* Effect.yieldNow;
        expect(interruptedHandler).toBeDefined();
        yield* Deferred.succeed(finishAcquire, undefined);
        yield* Fiber.join(interruption);
        expect(interruptedDisposeCount).toBe(1);
        expect(interruptedHandler).toBeUndefined();
      }),
    ),
  );
});
