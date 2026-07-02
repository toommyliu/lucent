import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as TestClock from "effect/testing/TestClock";

import { EventsApi, type EventsApiShape } from "../api/Events";
import { PlayerApi, type PlayerApiShape } from "../api/Player";
import type { FlashEvent } from "../Types";
import { WorldState } from "../state/World";
import * as WorldStore from "../state/World";
import { matchesEventSelector } from "../protocol/PacketSelectors";
import { AutoZone, layer as AutoZoneLayer } from "./AutoZone";

const packet = {
  command: "event",
  data: { args: { zoneSet: "A" }, cmd: "event" },
  direction: "server",
  raw: "{}",
  wireType: "json",
} as const;

const makeHarness = (
  auraNames: readonly string[] = [],
): Effect.Effect<{
  readonly emit: (event: FlashEvent) => Effect.Effect<void>;
  readonly layer: Layer.Layer<AutoZone | EventsApi | PlayerApi | WorldState>;
  readonly walks: readonly { readonly x: number; readonly y: number }[];
}> =>
  Effect.sync(() => {
    const handlers: Array<{
      readonly handler: (event: FlashEvent) => Effect.Effect<void>;
      readonly selector: Parameters<EventsApiShape["on"]>[0];
    }> = [];
    const walks: Array<{ readonly x: number; readonly y: number }> = [];
    const auras = new Set(auraNames.map((name) => name.toLowerCase()));
    const events = EventsApi.of({
      on: (selector, handler) =>
        Effect.sync(() => {
          handlers.push({ handler, selector });
          return () => {
            const index = handlers.findIndex(
              (entry) => entry.handler === handler,
            );
            if (index >= 0) {
              handlers.splice(index, 1);
            }
          };
        }),
      once: () => Effect.succeed(null),
    } satisfies EventsApiShape);
    const player = PlayerApi.of({
      auras: {
        get: (auraName) =>
          Effect.succeed(
            auras.has(auraName.toLowerCase())
              ? {
                  duration: 1,
                  name: auraName,
                  stack: 1,
                }
              : null,
          ),
        getAll: () => Effect.succeed([]),
        has: (auraName) => Effect.succeed(auras.has(auraName.toLowerCase())),
      },
      factions: {
        get: () => Effect.succeed(null),
        getAll: () => Effect.succeed([]),
      },
      getCell: () => Effect.succeed("Enter"),
      getClassName: () => Effect.succeed("Class"),
      getGender: () => Effect.succeed("M"),
      getGold: () => Effect.succeed(0),
      getHp: () => Effect.succeed(100),
      getLevel: () => Effect.succeed(1),
      getMaxHp: () => Effect.succeed(100),
      getMaxMp: () => Effect.succeed(100),
      getMp: () => Effect.succeed(100),
      getPad: () => Effect.succeed("Spawn"),
      getPosition: () => Effect.succeed({ x: 0, y: 0 }),
      getState: () => Effect.succeed(1),
      goToPlayer: () => Effect.void,
      hasActiveBoost: () => Effect.succeed(false),
      isAfk: () => Effect.succeed(false),
      isAlive: () => Effect.succeed(true),
      isMember: () => Effect.succeed(false),
      isReady: () => Effect.succeed(true),
      joinMap: () => Effect.succeed(true),
      jumpToCell: () => Effect.void,
      outfits: {
        equip: () => Effect.succeed(false),
        get: () => Effect.succeed(null),
        getAll: () => Effect.succeed([]),
        wear: () => Effect.succeed(false),
      },
      rest: () => Effect.void,
      useBoost: () => Effect.succeed(false),
      walkTo: (x, y) =>
        Effect.sync(() => {
          walks.push({ x, y });
          return true;
        }),
    } satisfies PlayerApiShape);
    const emit = (event: FlashEvent) =>
      Effect.forEach(
        handlers,
        (entry) =>
          matchesEventSelector(event, entry.selector)
            ? entry.handler(event)
            : Effect.void,
        { discard: true },
      );

    return {
      emit,
      layer: AutoZoneLayer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(EventsApi, events),
            Layer.succeed(PlayerApi, player),
            WorldStore.layer,
          ),
        ),
      ),
      walks,
    };
  });

const zoneEvent = (map: string, zone: string): FlashEvent => ({
  packet,
  payload: { map, zone },
  type: "zone",
});

describe("AutoZone", () => {
  it.effect("emits current and updated state to listeners", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          const seen: string[] = [];
          yield* autoZone.onState((state) => {
            seen.push(`${state.enabled}:${state.map ?? ""}`);
          });

          yield* autoZone.setMap("ledgermayne");
          yield* autoZone.setEnabled(true);

          expect(seen).toEqual([
            "false:",
            "false:ledgermayne",
            "true:ledgermayne",
          ]);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("ignores disabled and wrong-map zones, then walks in range", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          yield* autoZone.setMap("ledgermayne");
          yield* harness.emit(zoneEvent("ledgermayne", "A"));
          expect(harness.walks).toHaveLength(0);

          yield* autoZone.setEnabled(true);
          yield* harness.emit(zoneEvent("battleon", "A"));
          expect(harness.walks).toHaveLength(0);

          yield* harness.emit(zoneEvent("ledgermayne", "A"));
          expect(harness.walks).toHaveLength(1);
          const walk = harness.walks[0]!;
          expect(walk.x).toBeGreaterThanOrEqual(147);
          expect(walk.x).toBeLessThanOrEqual(276);
          expect(walk.y).toBeGreaterThanOrEqual(353);
          expect(walk.y).toBeLessThanOrEqual(357);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "walks Queen Iona unknown zones to center after aura settle delay",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoZone = yield* AutoZone;
            const world = yield* WorldState;
            yield* world.patchMap({ name: "queeniona" });
            yield* autoZone.setMap("queeniona");
            yield* autoZone.setEnabled(true);

            yield* harness.emit(zoneEvent("queeniona", ""));
            yield* Effect.yieldNow;
            expect(harness.walks).toHaveLength(0);
            yield* TestClock.adjust("500 millis");
            yield* Effect.yieldNow;
            expect(harness.walks).toEqual([{ x: 490, y: 320 }]);
          }).pipe(
            Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())),
          ),
        );
      }),
  );

  it.effect("walks Queen Iona charge zones according to self charge", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(["Positive Charge"]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          const world = yield* WorldState;
          yield* world.patchMap({ name: "queeniona" });
          yield* autoZone.setMap("queeniona");
          yield* autoZone.setEnabled(true);

          yield* harness.emit(zoneEvent("queeniona", "A"));
          yield* Effect.yieldNow;
          yield* TestClock.adjust("500 millis");
          yield* Effect.yieldNow;

          expect(harness.walks).toHaveLength(1);
          const walk = harness.walks[0]!;
          expect(walk.x).toBeGreaterThanOrEqual(746);
          expect(walk.x).toBeLessThanOrEqual(869);
          expect(walk.y).toBeGreaterThanOrEqual(369);
          expect(walk.y).toBeLessThanOrEqual(379);
        }).pipe(
          Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())),
        ),
      );
    }),
  );

  it.effect(
    "uses projected charge aura target when self identity is missing",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoZone = yield* AutoZone;
            const world = yield* WorldState;
            yield* world.patchMap({ name: "queeniona" });
            yield* world.setAura("player", 45188, {
              duration: 6,
              name: "Positive Charge",
              stack: 1,
            });
            yield* autoZone.setMap("queeniona");
            yield* autoZone.setEnabled(true);

            yield* harness.emit(zoneEvent("queeniona", "B"));
            yield* Effect.yieldNow;
            yield* TestClock.adjust("500 millis");
            yield* Effect.yieldNow;

            expect(harness.walks).toHaveLength(1);
            const walk = harness.walks[0]!;
            expect(walk.x).toBeGreaterThanOrEqual(111);
            expect(walk.x).toBeLessThanOrEqual(272);
            expect(walk.y).toBeGreaterThanOrEqual(369);
            expect(walk.y).toBeLessThanOrEqual(379);
          }).pipe(
            Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())),
          ),
        );
      }),
  );

  it.effect("uses the latest Queen Iona zone event for delayed movement", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(["Positive Charge"]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          const world = yield* WorldState;
          yield* world.patchMap({ name: "queeniona" });
          yield* autoZone.setMap("queeniona");
          yield* autoZone.setEnabled(true);

          yield* harness.emit(zoneEvent("queeniona", "A"));
          yield* Effect.yieldNow;
          yield* harness.emit(zoneEvent("queeniona", ""));
          yield* TestClock.adjust("500 millis");
          yield* Effect.yieldNow;

          expect(harness.walks).toEqual([{ x: 490, y: 320 }]);
        }).pipe(
          Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())),
        ),
      );
    }),
  );

  it.effect("ignores stale Queen Iona delayed work after disable", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(["Positive Charge"]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          const world = yield* WorldState;
          yield* world.patchMap({ name: "queeniona" });
          yield* autoZone.setMap("queeniona");
          yield* autoZone.setEnabled(true);
          yield* harness.emit(zoneEvent("queeniona", "A"));
          yield* Effect.yieldNow;
          yield* autoZone.setEnabled(false);
          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;

          expect(harness.walks).toHaveLength(0);
        }).pipe(
          Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())),
        ),
      );
    }),
  );
});
