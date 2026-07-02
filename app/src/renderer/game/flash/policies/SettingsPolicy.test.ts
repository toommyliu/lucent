import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as TestClock from "effect/testing/TestClock";

import type { FlashEvent } from "../Types";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import { EventsApi, type EventsApiShape } from "../api/Events";
import { PlayerApi, type PlayerApiShape } from "../api/Player";
import { SettingsApi, layer as SettingsLayer } from "../api/Settings";
import { Jobs, layer as JobsLayer } from "../jobs/Jobs";
import { matchesEventSelector } from "../protocol/PacketSelectors";
import { layer as SettingsStateLayer } from "../state/Settings";
import { layer as SettingsPolicyLayer } from "./SettingsPolicy";

const SETTINGS_ACTION_JOB_KEY = "settings/actions";

const connectionEvent = (status: string): FlashEvent => ({
  payload: { status },
  type: "connection",
});

const actionCallCount = (
  calls: readonly { readonly method: string }[],
): number =>
  calls.filter(
    (call) =>
      call.method === "settings.enemyMagnet" ||
      call.method === "settings.infiniteRange" ||
      call.method === "settings.provokeCell" ||
      call.method === "settings.skipCutscenes",
  ).length;

const makeHarness = () => {
  let ready = false;
  const calls: Array<{
    readonly args: readonly unknown[];
    readonly method: string;
  }> = [];
  const handlers: Array<{
    readonly handler: (event: FlashEvent) => Effect.Effect<void>;
    readonly selector: Parameters<EventsApiShape["on"]>[0];
  }> = [];

  const bridge = SwfBridge.of({
    call: ((method, args) =>
      Effect.sync(() => {
        calls.push({ args: args ?? [], method });
        return undefined;
      })) as SwfBridgeShape["call"],
    callGameFunction: () => Effect.succeed(null),
    readJson: () => Effect.succeed(null),
  });
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
    isReady: Effect.sync(() => ready),
  } as PlayerApiShape);

  const base = Layer.mergeAll(
    SettingsStateLayer,
    TestClock.layer(),
    Layer.succeed(EventsApi, events),
    Layer.succeed(PlayerApi, player),
    Layer.succeed(SwfBridge, bridge),
  );
  const settings = SettingsLayer.pipe(Layer.provideMerge(base));
  const services = Layer.mergeAll(settings, JobsLayer);
  const layer = SettingsPolicyLayer.pipe(Layer.provideMerge(services));

  return {
    calls,
    emit: (event: FlashEvent) =>
      Effect.forEach(
        handlers,
        (entry) =>
          matchesEventSelector(event, entry.selector)
            ? entry.handler(event)
            : Effect.void,
        { discard: true },
      ),
    layer,
    setReady: (value: boolean) => {
      ready = value;
    },
  };
};

describe("SettingsPolicy", () => {
  it.effect("reapplies settings every second only when player is ready", () =>
    Effect.gen(function* () {
      const harness = makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.yieldNow;
          expect(harness.calls).toHaveLength(0);

          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;
          expect(harness.calls).toHaveLength(0);

          harness.setReady(true);
          yield* TestClock.adjust("1 second");
          yield* Effect.yieldNow;
          expect(harness.calls.length).toBeGreaterThan(0);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("connection event triggers an immediate full settings apply", () =>
    Effect.gen(function* () {
      const harness = makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* harness.emit(connectionEvent("OnConnection"));

          expect(harness.calls.length).toBeGreaterThan(0);
          expect(
            harness.calls.some(
              (call) => call.method === "settings.setWalkSpeed",
            ),
          ).toBe(true);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("recurring setting state starts and stops the action job", () =>
    Effect.gen(function* () {
      const harness = makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const jobs = yield* Jobs;
          const settings = yield* SettingsApi;

          expect(yield* jobs.isRunning(SETTINGS_ACTION_JOB_KEY)).toBe(false);

          yield* settings.setEnemyMagnetEnabled(true);
          yield* Effect.yieldNow;
          expect(yield* jobs.isRunning(SETTINGS_ACTION_JOB_KEY)).toBe(true);

          yield* settings.setEnemyMagnetEnabled(false);
          yield* Effect.yieldNow;
          expect(yield* jobs.isRunning(SETTINGS_ACTION_JOB_KEY)).toBe(false);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("recurring action job runs every 500 millis only when ready", () =>
    Effect.gen(function* () {
      const harness = makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const settings = yield* SettingsApi;

          harness.setReady(true);
          yield* settings.setEnemyMagnetEnabled(true);
          yield* Effect.yieldNow;
          const afterStart = actionCallCount(harness.calls);
          expect(afterStart).toBe(1);

          yield* TestClock.adjust("500 millis");
          yield* Effect.yieldNow;
          const afterTick = actionCallCount(harness.calls);
          expect(afterTick).toBeGreaterThan(afterStart);

          harness.setReady(false);
          yield* TestClock.adjust("500 millis");
          yield* Effect.yieldNow;
          expect(actionCallCount(harness.calls)).toBe(afterTick);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );
});
