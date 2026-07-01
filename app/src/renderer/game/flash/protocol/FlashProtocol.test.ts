import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, PubSub } from "effect";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import type { FlashCallback } from "../FlashCallbacks";
import { FlashCallbacks } from "../FlashCallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import { WorldState } from "../state/World";
import * as WorldStateStore from "../state/World";
import { FlashProtocol, layer as FlashProtocolLayer } from "./FlashProtocol";

interface ProtocolHarness {
  readonly calls: Array<{
    readonly args: readonly unknown[];
    readonly method: string;
  }>;
  readonly layer: Layer.Layer<
    FlashCallbacks | SwfBridge | WorldState | FlashProtocol
  >;
  readonly publish: (event: FlashCallback) => Effect.Effect<void>;
}

const makeHarness = (): Effect.Effect<ProtocolHarness> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<FlashCallback>();
    const publish = (event: FlashCallback) =>
      PubSub.publish(pubsub, event).pipe(Effect.asVoid);
    const callbacks = FlashCallbacks.of({
      publish,
      subscribe: PubSub.subscribe(pubsub),
    });
    const calls: ProtocolHarness["calls"] = [];
    const bridge = SwfBridge.of({
      call: ((method, args) =>
        Effect.sync(() => {
          calls.push({ args: args ?? [], method });
          return bridgeFallbacks[method]();
        })) as SwfBridgeShape["call"],
      callGameFunction: (path, ...args) =>
        Effect.sync(() => {
          calls.push({ args, method: path });
          return null;
        }),
      readJson: () => Effect.succeed(null),
    });
    const base = Layer.mergeAll(
      Layer.succeed(FlashCallbacks, callbacks),
      Layer.succeed(SwfBridge, bridge),
      WorldStateStore.layer,
    );

    return {
      calls,
      layer: FlashProtocolLayer.pipe(Layer.provideMerge(base)),
      publish,
    };
  });

describe("FlashProtocol", () => {
  it.effect("dispatches once/on packet handlers and cleans up disposers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          let seen = 0;
          const dispose = yield* protocol.onPacket(
            { command: "equipItem" },
            () =>
              Effect.sync(() => {
                seen += 1;
              }),
          );
          const onceFiber = yield* protocol
            .oncePacket({ command: "equipItem" }, { timeout: "1 second" })
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;

          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
          yield* Effect.yieldNow;
          const oncePacket = yield* Fiber.join(onceFiber);
          yield* Effect.yieldNow;

          expect(oncePacket?.command).toBe("equipItem");
          expect(seen).toBe(1);

          dispose();
          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
          yield* Effect.yieldNow;
          expect(seen).toBe(1);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("resolves send placeholders through shared state", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          const world = yield* WorldState;

          yield* world.addPlayer({
            afk: false,
            cell: "Enter",
            entityId: 1,
            entityType: "player",
            hp: 100,
            level: 1,
            maxHp: 100,
            maxMp: 100,
            mp: 100,
            name: "TestHero",
            pad: "Spawn",
            position: [0, 0],
            state: 1,
            username: "TestHero",
          });
          yield* world.setSelf("TestHero");
          yield* world.patchMap({
            id: 42,
            name: "battleon",
            roomNumber: 9001,
          });

          yield* protocol.sendClient(
            "%xt%zm%cmd%{MAP_ID}%{ROOM_NUMBER}%{MAP_NAME}%{PLAYER_NAME}%",
          );
          yield* protocol.sendServer("join:{MAP_NAME}-{ROOM_NUMBER}");

          expect(harness.calls).toEqual([
            {
              args: ["%xt%zm%cmd%42%9001%battleon%TestHero%", "str"],
              method: "flash.sendClientPacket",
            },
            {
              args: ["join:battleon-9001"],
              method: "sfc.sendString",
            },
          ]);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );
});
