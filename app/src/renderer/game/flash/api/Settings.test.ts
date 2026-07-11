import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import { layer as SettingsStateLayer } from "../state/Settings";
import { SettingsApi, layer as SettingsApiLayer } from "./Settings";

describe("Settings API", () => {
  it.effect(
    "maps a normalized full patch to persistent and recurring actions",
    () =>
      Effect.gen(function* () {
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
        const layer = SettingsApiLayer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              SettingsStateLayer,
              Layer.succeed(SwfBridge, bridge),
            ),
          ),
        );

        yield* SettingsApi.pipe(
          Effect.flatMap((settings) =>
            settings.apply({
              animationsEnabled: false,
              collisionsEnabled: false,
              customGuild: "  Guild  ",
              customName: "  Hero  ",
              deathAdsVisible: false,
              enemyMagnetEnabled: true,
              frameRate: 200,
              infiniteRangeEnabled: true,
              lagKillerEnabled: true,
              otherPlayersVisible: false,
              provokeCellEnabled: true,
              skipCutscenesEnabled: true,
              walkSpeed: 200,
            }),
          ),
          Effect.provide(layer),
        );

        expect(calls).toEqual([
          { args: [false], method: "settings.setAnimationsEnabled" },
          { args: [false], method: "settings.setCollisionsEnabled" },
          { args: ["Guild"], method: "settings.setCustomGuild" },
          { args: ["Hero"], method: "settings.setCustomName" },
          { args: [false], method: "settings.setDeathAdsVisible" },
          { args: [60], method: "settings.setFrameRate" },
          { args: [true], method: "settings.setLagKillerEnabled" },
          { args: [false], method: "settings.setOtherPlayersVisible" },
          { args: [100], method: "settings.setWalkSpeed" },
          { args: [], method: "settings.enemyMagnet" },
          { args: [], method: "settings.infiniteRange" },
          { args: [], method: "settings.provokeCell" },
          { args: [], method: "settings.skipCutscenes" },
        ]);
      }),
  );
});
