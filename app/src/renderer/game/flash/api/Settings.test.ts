import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import { layer as SettingsStateLayer } from "../state/Settings";
import { SettingsApi, layer as SettingsLayer } from "./Settings";

const makeHarness = () => {
  const calls: Array<{
    readonly args: readonly unknown[];
    readonly method: string;
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

  return {
    calls,
    layer: SettingsLayer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(SettingsStateLayer, Layer.succeed(SwfBridge, bridge)),
      ),
    ),
  };
};

describe("SettingsApi", () => {
  it.effect("normalizes setters, calls bridge setters, and emits state", () =>
    Effect.gen(function* () {
      const harness = makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const settings = yield* SettingsApi;
          const seen: string[] = [];
          yield* settings.onState((state) => {
            seen.push(
              `${state.walkSpeed}:${state.frameRate}:${state.customName}`,
            );
          });

          yield* settings.setWalkSpeed(1_000);
          yield* settings.setFrameRate(Number.NaN);
          yield* settings.setCustomName("  Hero  ");

          expect(yield* settings.get()).toMatchObject({
            customName: "Hero",
            frameRate: 30,
            walkSpeed: 100,
          });
          expect(seen).toEqual(["8:30:", "100:30:", "100:30:Hero"]);
          expect(harness.calls).toEqual([
            { args: [100], method: "settings.setWalkSpeed" },
            { args: [30], method: "settings.setFrameRate" },
            { args: ["Hero"], method: "settings.setCustomName" },
          ]);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "recurring toggles patch state without immediate action calls",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();

        yield* Effect.scoped(
          Effect.gen(function* () {
            const settings = yield* SettingsApi;

            yield* settings.setEnemyMagnetEnabled(true);
            yield* settings.setInfiniteRangeEnabled(true);

            expect(yield* settings.get()).toMatchObject({
              enemyMagnetEnabled: true,
              infiniteRangeEnabled: true,
            });
            expect(harness.calls).toEqual([]);
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );

  it.effect("empty custom name and guild are stored but not applied", () =>
    Effect.gen(function* () {
      const harness = makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const settings = yield* SettingsApi;

          yield* settings.setCustomName("   ");
          yield* settings.setCustomGuild("");
          const current = yield* settings.get();
          yield* settings.apply(current);

          expect(yield* settings.get()).toMatchObject({
            customGuild: "",
            customName: "",
          });
          expect(
            harness.calls.filter(
              (call) =>
                call.method === "settings.setCustomName" ||
                call.method === "settings.setCustomGuild",
            ),
          ).toEqual([]);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "apply calls persistent setters and enabled recurring actions only",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();

        yield* Effect.scoped(
          Effect.gen(function* () {
            const settings = yield* SettingsApi;

            yield* settings.apply({
              enemyMagnetEnabled: true,
              frameRate: 240,
              infiniteRangeEnabled: false,
              provokeCellEnabled: true,
              walkSpeed: 12,
            });

            expect(harness.calls).toEqual([
              { args: [120], method: "settings.setFrameRate" },
              { args: [12], method: "settings.setWalkSpeed" },
              { args: [], method: "settings.enemyMagnet" },
              { args: [], method: "settings.provokeCell" },
            ]);
            expect(yield* settings.get()).toMatchObject({
              enemyMagnetEnabled: false,
              frameRate: 30,
              provokeCellEnabled: false,
              walkSpeed: 8,
            });
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );

  it.effect("anti-counter is local-only", () =>
    Effect.gen(function* () {
      const harness = makeHarness();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const settings = yield* SettingsApi;

          yield* settings.setAntiCounterEnabled(false);

          expect(yield* settings.get()).toMatchObject({
            antiCounterEnabled: false,
          });
          expect(harness.calls).toEqual([]);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );
});
