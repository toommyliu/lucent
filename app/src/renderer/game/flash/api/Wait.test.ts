import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import * as TestClock from "effect/testing/TestClock";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import type { FlashProtocolShape } from "../protocol/FlashProtocol";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { WaitApi, layer as WaitApiLayer } from "./Wait";

const makeLayer = (available: boolean) => {
  const bridge = SwfBridge.of({
    call: ((method) =>
      Effect.succeed(
        method === "world.isActionAvailable"
          ? available
          : bridgeFallbacks[method](),
      )) as SwfBridgeShape["call"],
    callGameFunction: () => Effect.succeed(null),
    readJson: () => Effect.succeed(null),
  });
  const protocol = FlashProtocol.of({
    emitEvent: () => Effect.void,
    onEvent: () => Effect.succeed(() => {}),
    onPacket: () => Effect.succeed(() => {}),
    onceEvent: () => Effect.succeed(null),
    oncePacket: () => Effect.succeed(null),
    sendClient: () => Effect.void,
    sendServer: () => Effect.void,
  } satisfies FlashProtocolShape);

  return WaitApiLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(SwfBridge, bridge),
        Layer.succeed(FlashProtocol, protocol),
      ),
    ),
  );
};

describe("WaitApi", () => {
  it.effect("returns false when polling times out", () =>
    Effect.gen(function* () {
      const wait = yield* WaitApi;

      const untilFiber = yield* wait
        .until(Effect.succeed(false), {
          interval: "1 millis",
          timeout: "10 millis",
        })
        .pipe(Effect.forkScoped);
      const actionFiber = yield* wait
        .forGameAction("equipItem", "10 millis")
        .pipe(Effect.forkScoped);
      yield* TestClock.adjust("20 millis");

      expect(yield* Fiber.join(untilFiber)).toBe(false);
      expect(yield* Fiber.join(actionFiber)).toBe(false);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(makeLayer(false), TestClock.layer())),
    ),
  );

  it.effect("returns true when game action is available", () =>
    Effect.gen(function* () {
      const wait = yield* WaitApi.pipe(Effect.provide(makeLayer(true)));

      expect(yield* wait.forGameAction("equipItem", "10 millis")).toBe(true);
    }),
  );
});
