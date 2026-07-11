import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Queue, Ref } from "effect";
import { EntityState, LivePlayer } from "@lucent/game";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import type { FlashCallback } from "../FlashCallbacks";
import { FlashCallbacks } from "../FlashCallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import { WorldState } from "../state/World";
import * as WorldStateStore from "../state/World";
import {
  FlashProtocol,
  type FlashProtocolShape,
  layer as FlashProtocolLayer,
} from "./FlashProtocol";

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
    const queue = yield* Queue.unbounded<FlashCallback>();
    const publish = (event: FlashCallback) =>
      Queue.offer(queue, event).pipe(Effect.asVoid);
    const callbacks = FlashCallbacks.of({
      publish,
      take: () => Queue.take(queue),
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

const startProtocol = (protocol: FlashProtocolShape) =>
  Effect.gen(function* () {
    yield* protocol.installPacketProjector(() => Effect.succeed([]));
    yield* protocol.installRuntimeProjector(() => Effect.void);
    yield* protocol.start();
  });

const interruptsBlockedProjection = (kind: "packet" | "runtime") =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const projectionStarted = yield* Deferred.make<void>();
    const keepLayerOpen = yield* Deferred.make<void>();
    let publiclyObserved = false;
    const markObserved = () =>
      Effect.sync(() => {
        publiclyObserved = true;
      });

    const fiber = yield* Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* FlashProtocol;
        if (kind === "packet") {
          yield* protocol.installPacketProjector(() =>
            Deferred.succeed(projectionStarted, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
          );
          yield* protocol.installRuntimeProjector(() => Effect.void);
          yield* protocol.onPacket(undefined, markObserved);
          yield* protocol.start();
          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
        } else {
          yield* protocol.installPacketProjector(() => Effect.succeed([]));
          yield* protocol.installRuntimeProjector((event) =>
            event.type === "connection"
              ? Deferred.succeed(projectionStarted, undefined).pipe(
                  Effect.andThen(Effect.never),
                )
              : Effect.void,
          );
          yield* protocol.onEvent(
            { kind: "runtime", type: "connection" },
            markObserved,
          );
          yield* protocol.start();
          yield* harness.publish({ status: "Success", type: "connection" });
        }
        yield* Deferred.await(keepLayerOpen);
      }).pipe(Effect.provide(harness.layer)),
    ).pipe(Effect.forkChild({ startImmediately: true }));

    yield* Deferred.await(projectionStarted);
    yield* Fiber.interrupt(fiber);
    return publiclyObserved;
  });

describe("FlashProtocol", () => {
  it.effect("dispatches once/on packet handlers and cleans up disposers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          yield* startProtocol(protocol);
          let seen = 0;
          const firstSeen = yield* Deferred.make<void>();
          const dispose = yield* protocol.onPacket(
            { command: "equipItem" },
            () =>
              Effect.gen(function* () {
                seen += 1;
                yield* Deferred.succeed(firstSeen, undefined);
              }),
          );
          const onceFiber = yield* protocol
            .oncePacket({ command: "equipItem" }, { timeout: "1 second" })
            .pipe(Effect.forkScoped({ startImmediately: true }));
          const packetEventFiber = yield* protocol
            .onceEvent(
              { kind: "packet", type: "packetReceived" },
              { timeout: "1 second" },
            )
            .pipe(Effect.forkScoped({ startImmediately: true }));

          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
          const oncePacket = yield* Fiber.join(onceFiber);
          const packetEvent = yield* Fiber.join(packetEventFiber);
          yield* Deferred.await(firstSeen);

          expect(oncePacket?.command).toBe("equipItem");
          expect(packetEvent?.kind).toBe("packet");
          expect(packetEvent?.type).toBe("packetReceived");
          expect(
            packetEvent?.type === "packetReceived"
              ? packetEvent.payload.command
              : "",
          ).toBe("equipItem");
          expect(seen).toBe(1);

          dispose();
          const secondOnceFiber = yield* protocol
            .oncePacket({ command: "equipItem" }, { timeout: "1 second" })
            .pipe(Effect.forkScoped({ startImmediately: true }));
          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
          yield* Fiber.join(secondOnceFiber);
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

          yield* world.addPlayer(
            new LivePlayer({
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
              position: { x: 0, y: 0 },
              state: EntityState.Idle,
              username: "TestHero",
            }),
          );
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

  it.effect(
    "buffers callbacks until projectors are installed and preserves projection order",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();

        yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* FlashProtocol;
            const projected = yield* Ref.make<readonly number[]>([]);
            const observed = yield* Ref.make<readonly string[]>([]);
            const firstStarted = yield* Deferred.make<void>();
            const releaseFirst = yield* Deferred.make<void>();
            const secondProjected = yield* Deferred.make<void>();
            const secondObserved = yield* Deferred.make<void>();
            const secondProjectionObserved = yield* Deferred.make<void>();

            yield* protocol.installPacketProjector((packet) =>
              Effect.gen(function* () {
                const itemId =
                  packet.direction === "client"
                    ? 0
                    : Number(
                        (packet.data as Record<string, unknown>)["ItemID"],
                      );
                if (itemId === 1) {
                  yield* Deferred.succeed(firstStarted, undefined);
                  yield* Deferred.await(releaseFirst);
                }
                yield* Ref.update(projected, (values) => [...values, itemId]);
                if (itemId === 2) {
                  yield* Deferred.succeed(secondProjected, undefined);
                }

                return [
                  {
                    kind: "projection",
                    packet,
                    payload: { itemId },
                    type: "questComplete",
                  },
                ];
              }),
            );
            yield* protocol.installRuntimeProjector(() => Effect.void);
            yield* protocol.onEvent(undefined, (event) =>
              Effect.gen(function* () {
                yield* Ref.update(observed, (values) => [
                  ...values,
                  event.type === "packetReceived"
                    ? `packet:${event.payload.command}`
                    : event.type === "questComplete"
                      ? `projection:${String(event.payload["itemId"])}`
                      : event.type,
                ]);
                if (
                  event.type === "questComplete" &&
                  event.payload["itemId"] === 2
                ) {
                  yield* Deferred.succeed(secondProjectionObserved, undefined);
                }
              }),
            );
            yield* protocol.onPacket(undefined, (packet) =>
              Effect.gen(function* () {
                const itemId =
                  packet.direction === "client"
                    ? 0
                    : Number(
                        (packet.data as Record<string, unknown>)["ItemID"],
                      );
                yield* Ref.update(observed, (values) => [
                  ...values,
                  `observer:${itemId}`,
                ]);
                if (itemId === 2) {
                  yield* Deferred.succeed(secondObserved, undefined);
                }
              }),
            );

            yield* harness.publish({
              raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
              type: "server-packet",
            });
            yield* harness.publish({
              raw: JSON.stringify({ cmd: "equipItem", ItemID: 2 }),
              type: "server-packet",
            });

            expect(yield* Ref.get(projected)).toEqual([]);
            expect(yield* Ref.get(observed)).toEqual([]);

            yield* protocol.start();
            yield* Deferred.await(firstStarted);
            expect(yield* Ref.get(projected)).toEqual([]);
            expect(yield* Ref.get(observed)).toEqual([]);

            yield* Deferred.succeed(releaseFirst, undefined);
            yield* Deferred.await(secondProjected);
            yield* Deferred.await(secondObserved);
            yield* Deferred.await(secondProjectionObserved);

            expect(yield* Ref.get(projected)).toEqual([1, 2]);
            expect(yield* Ref.get(observed)).toEqual([
              "packet:equipItem",
              "observer:1",
              "projection:1",
              "packet:equipItem",
              "observer:2",
              "projection:2",
            ]);
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );

  it.effect("runs runtime projection before detached public observers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          const releaseProjection = yield* Deferred.make<void>();
          const projectionStarted = yield* Deferred.make<void>();
          const publicObserved = yield* Deferred.make<boolean>();
          let projected = false;

          yield* protocol.installPacketProjector(() => Effect.succeed([]));
          yield* protocol.installRuntimeProjector((event) =>
            event.type === "connection"
              ? Effect.gen(function* () {
                  yield* Deferred.succeed(projectionStarted, undefined);
                  yield* Deferred.await(releaseProjection);
                  projected = true;
                })
              : Effect.void,
          );
          yield* protocol.onEvent({ kind: "runtime", type: "connection" }, () =>
            Deferred.succeed(publicObserved, projected).pipe(Effect.asVoid),
          );
          yield* protocol.start();

          yield* harness.publish({
            status: "OnConnectionLost",
            type: "connection",
          });
          yield* Deferred.await(projectionStarted);
          expect(yield* Deferred.poll(publicObserved)).toEqual(Option.none());

          yield* Deferred.succeed(releaseProjection, undefined);
          expect(yield* Deferred.await(publicObserved)).toBe(true);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("keeps critical projectors installed after startup", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          let packetProjected = false;
          let runtimeProjected = false;
          const disposePacket = yield* protocol.installPacketProjector(() =>
            Effect.sync(() => {
              packetProjected = true;
              return [];
            }),
          );
          const disposeRuntime = yield* protocol.installRuntimeProjector(() =>
            Effect.sync(() => {
              runtimeProjected = true;
            }),
          );
          yield* protocol.start();

          disposePacket();
          disposeRuntime();

          const runtimeObserved = yield* protocol
            .onceEvent(
              { kind: "runtime", type: "connection" },
              { timeout: "1 second" },
            )
            .pipe(Effect.forkScoped({ startImmediately: true }));
          const packetObserved = yield* protocol
            .onceEvent(
              { kind: "packet", type: "packetReceived" },
              { timeout: "1 second" },
            )
            .pipe(Effect.forkScoped({ startImmediately: true }));

          yield* harness.publish({ status: "Success", type: "connection" });
          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
          yield* Fiber.join(runtimeObserved);
          yield* Fiber.join(packetObserved);

          expect(runtimeProjected).toBe(true);
          expect(packetProjected).toBe(true);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("does not let a blocked public listener stall projection", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          const listenerStarted = yield* Deferred.make<void>();
          const releaseListener = yield* Deferred.make<void>();
          const secondProjected = yield* Deferred.make<void>();

          yield* protocol.installPacketProjector((packet) =>
            packet.direction !== "client" &&
            (packet.data as Record<string, unknown>)["ItemID"] === 2
              ? Deferred.succeed(secondProjected, undefined).pipe(Effect.as([]))
              : Effect.succeed([]),
          );
          yield* protocol.installRuntimeProjector(() => Effect.void);
          yield* protocol.onPacket(undefined, () =>
            Deferred.succeed(listenerStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseListener)),
            ),
          );
          yield* protocol.start();

          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 2 }),
            type: "server-packet",
          });

          yield* Deferred.await(listenerStarted);
          yield* Deferred.await(secondProjected);
          yield* Deferred.succeed(releaseListener, undefined);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("continues dispatching after ordinary projector failures", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* FlashProtocol;
          const allObserved = yield* Deferred.make<void>();
          let packetProjections = 0;
          let runtimeProjections = 0;
          let packetsObserved = 0;
          let runtimeEventsObserved = 0;

          yield* protocol.installPacketProjector(() => {
            packetProjections += 1;
            return packetProjections === 1
              ? Effect.die("packet projection failed")
              : Effect.succeed([]);
          });
          yield* protocol.installRuntimeProjector((event) =>
            event.type !== "connection"
              ? Effect.void
              : Effect.gen(function* () {
                  runtimeProjections += 1;
                  if (runtimeProjections === 1) {
                    return yield* Effect.die("runtime projection failed");
                  }
                }),
          );
          yield* protocol.onEvent(undefined, (event) =>
            Effect.gen(function* () {
              if (event.type === "connection") runtimeEventsObserved += 1;
              if (event.type === "packetReceived") packetsObserved += 1;
              if (runtimeEventsObserved === 2 && packetsObserved === 2) {
                yield* Deferred.succeed(allObserved, undefined);
              }
            }),
          );
          yield* protocol.start();

          yield* harness.publish({ status: "First", type: "connection" });
          yield* harness.publish({ status: "Second", type: "connection" });
          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 1 }),
            type: "server-packet",
          });
          yield* harness.publish({
            raw: JSON.stringify({ cmd: "equipItem", ItemID: 2 }),
            type: "server-packet",
          });
          yield* Deferred.await(allObserved);

          expect({
            packetProjections,
            packetsObserved,
            runtimeEventsObserved,
            runtimeProjections,
          }).toEqual({
            packetProjections: 2,
            packetsObserved: 2,
            runtimeEventsObserved: 2,
            runtimeProjections: 2,
          });
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("does not recover from interruption during projection", () =>
    Effect.gen(function* () {
      expect(yield* interruptsBlockedProjection("packet")).toBe(false);
      expect(yield* interruptsBlockedProjection("runtime")).toBe(false);
    }),
  );
});
