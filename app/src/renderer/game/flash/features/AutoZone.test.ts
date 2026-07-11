import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { LiveAura } from "@lucent/game";

import { EventsApi, type EventsApiShape } from "../api/Events";
import { PlayerApi, type PlayerApiShape } from "../api/Player";
import type { FlashEvent } from "../Types";
import { matchesEventSelector } from "../protocol/PacketSelectors";
import { WorldState } from "../state/World";
import * as WorldStore from "../state/World";
import {
  AutoZone,
  layer as AutoZoneLayer,
  selectAutoZoneTarget,
} from "./AutoZone";

const packet = {
  command: "event",
  data: { args: { zoneSet: "A" }, cmd: "event" },
  direction: "server",
  raw: "{}",
  wireType: "json",
} as const;

const zoneEvent = (map: string, zone: string): FlashEvent => ({
  kind: "projection",
  packet,
  payload: { map, zone },
  type: "zone",
});

const makeHarness = (auraNames: readonly string[] = []) => {
  const handlers: Array<{
    readonly handler: (event: FlashEvent) => Effect.Effect<void>;
    readonly selector: Parameters<EventsApiShape["on"]>[0];
  }> = [];
  const walks: Array<{ readonly x: number; readonly y: number }> = [];
  const auras = new Set(auraNames.map((name) => name.toLowerCase()));
  const events = EventsApi.of({
    on: (selector, handler) =>
      Effect.sync(() => {
        const entry = { handler, selector };
        handlers.push(entry);
        return () => {
          const index = handlers.indexOf(entry);
          if (index >= 0) handlers.splice(index, 1);
        };
      }),
  } as EventsApiShape);
  const player = PlayerApi.of({
    auras: {
      has: (name: string) => Effect.succeed(auras.has(name.toLowerCase())),
    },
    walkTo: (x: number, y: number) =>
      Effect.sync(() => {
        walks.push({ x, y });
        return true;
      }),
  } as PlayerApiShape);
  const emit = (event: FlashEvent) =>
    Effect.forEach(
      handlers,
      ({ handler, selector }) =>
        matchesEventSelector(event, selector) ? handler(event) : Effect.void,
      { discard: true },
    );
  const layer = AutoZoneLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(EventsApi, events),
        Layer.succeed(PlayerApi, player),
        WorldStore.layer,
        TestClock.layer(),
      ),
    ),
  );

  return { emit, layer, walks };
};

describe("AutoZone", () => {
  it("selects normal and charge-sensitive destinations", () => {
    expect(selectAutoZoneTarget("ledgermayne", "A")).toEqual({
      kind: "range",
      range: [
        [147, 276],
        [353, 357],
      ],
    });
    expect(selectAutoZoneTarget("ledgermayne", "missing")).toBeUndefined();
    expect(selectAutoZoneTarget("queeniona", "")).toEqual({
      kind: "point",
      x: 490,
      y: 320,
    });
    expect(selectAutoZoneTarget("queeniona", "A", "positive")).toEqual({
      kind: "range",
      range: [
        [746, 869],
        [369, 379],
      ],
    });
    expect(selectAutoZoneTarget("queeniona", "B", "positive")).toEqual({
      kind: "range",
      range: [
        [111, 272],
        [369, 379],
      ],
    });
    expect(selectAutoZoneTarget("queeniona", "A", "negative")).toEqual({
      kind: "range",
      range: [
        [111, 272],
        [369, 379],
      ],
    });
    expect(selectAutoZoneTarget("queeniona", "B", "negative")).toEqual({
      kind: "range",
      range: [
        [746, 869],
        [369, 379],
      ],
    });
    expect(selectAutoZoneTarget("queeniona", "A", "none")).toBeUndefined();
  });

  it.effect("publishes state and only handles enabled matching maps", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          const seen: string[] = [];
          yield* autoZone.onState((state) => {
            seen.push(`${state.enabled}:${state.map ?? ""}`);
          });

          yield* autoZone.setMap("ledgermayne");
          yield* harness.emit(zoneEvent("ledgermayne", "A"));
          yield* autoZone.setEnabled(true);
          yield* harness.emit(zoneEvent("battleon", "A"));
          yield* harness.emit(zoneEvent("ledgermayne", "A"));

          expect(seen).toEqual([
            "false:",
            "false:ledgermayne",
            "true:ledgermayne",
          ]);
          expect(harness.walks).toHaveLength(1);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("uses the latest delayed zone and projected charge fallback", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoZone = yield* AutoZone;
          const world = yield* WorldState;
          yield* world.patchMap({ name: "queeniona" });
          yield* world.setAura(
            "player",
            45_188,
            new LiveAura({
              duration: 6,
              kind: "active",
              name: "Positive Charge",
              stack: 1,
            }),
          );
          yield* autoZone.setMap("queeniona");
          yield* autoZone.setEnabled(true);

          yield* harness.emit(zoneEvent("queeniona", "A"));
          yield* Effect.yieldNow;
          yield* harness.emit(zoneEvent("queeniona", "B"));
          yield* TestClock.adjust("500 millis");
          yield* Effect.yieldNow;

          expect(harness.walks).toHaveLength(1);
          expect(harness.walks[0]?.x).toBeGreaterThanOrEqual(111);
          expect(harness.walks[0]?.x).toBeLessThanOrEqual(272);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "cancels delayed work, uses direct charge, and centers unknown zones",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness(["Positive Charge"]);
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
            expect(harness.walks).toEqual([]);

            yield* autoZone.setEnabled(true);
            yield* harness.emit(zoneEvent("queeniona", "A"));
            yield* Effect.yieldNow;
            yield* TestClock.adjust("500 millis");
            yield* Effect.yieldNow;
            expect(harness.walks).toHaveLength(1);
            expect(harness.walks[0]?.x).toBeGreaterThanOrEqual(746);
            expect(harness.walks[0]?.x).toBeLessThanOrEqual(869);

            yield* harness.emit(zoneEvent("queeniona", ""));
            yield* Effect.yieldNow;
            yield* TestClock.adjust("500 millis");
            yield* Effect.yieldNow;
            expect(harness.walks.at(-1)).toEqual({ x: 490, y: 320 });
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );
});
