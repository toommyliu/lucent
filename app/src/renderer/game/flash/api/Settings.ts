import { Context, Effect, Layer } from "effect";

import type { FlashSettingsSnapshot } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { SettingsState } from "../state/Settings";

export interface SettingsApiShape {
  readonly enemyMagnet: Effect.Effect<void>;
  readonly get: Effect.Effect<FlashSettingsSnapshot>;
  readonly infiniteRange: Effect.Effect<void>;
  readonly isAntiCounterEnabled: Effect.Effect<boolean>;
  readonly provokeCell: Effect.Effect<void>;
  readonly setAnimationsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setAntiCounterEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCollisionsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCustomGuild: (name: string) => Effect.Effect<void>;
  readonly setCustomName: (name: string) => Effect.Effect<void>;
  readonly setDeathAdsVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setEnemyMagnetEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setFrameRate: (fps: number) => Effect.Effect<void>;
  readonly setInfiniteRangeEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setLagKillerEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setOtherPlayersVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setProvokeCellEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setSkipCutscenesEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setWalkSpeed: (speed: number) => Effect.Effect<void>;
  readonly skipCutscenes: Effect.Effect<void>;
}

export class SettingsApi extends Context.Service<
  SettingsApi,
  SettingsApiShape
>()("lucent/game/flash/api/Settings") {}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.trunc(value)));

export const layer = Layer.effect(
  SettingsApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const state = yield* SettingsState;

    const enemyMagnet = bridge.call("settings.enemyMagnet");
    const infiniteRange = bridge.call("settings.infiniteRange");
    const provokeCell = bridge.call("settings.provokeCell");
    const skipCutscenes = bridge.call("settings.skipCutscenes");

    return SettingsApi.of({
      enemyMagnet,
      get: state.get,
      infiniteRange,
      isAntiCounterEnabled: state.get.pipe(
        Effect.map((settings) => settings.antiCounterEnabled),
      ),
      provokeCell,
      setAnimationsEnabled: (enabled) =>
        bridge
          .call("settings.setAnimationsEnabled", [enabled])
          .pipe(
            Effect.flatMap(() => state.patch({ animationsEnabled: enabled })),
          ),
      setAntiCounterEnabled: (enabled) =>
        state.patch({ antiCounterEnabled: enabled }),
      setCollisionsEnabled: (enabled) =>
        bridge
          .call("settings.setCollisionsEnabled", [enabled])
          .pipe(
            Effect.flatMap(() => state.patch({ collisionsEnabled: enabled })),
          ),
      setCustomGuild: (name) =>
        bridge
          .call("settings.setCustomGuild", [name])
          .pipe(Effect.flatMap(() => state.patch({ customGuild: name }))),
      setCustomName: (name) =>
        bridge
          .call("settings.setCustomName", [name])
          .pipe(Effect.flatMap(() => state.patch({ customName: name }))),
      setDeathAdsVisible: (visible) =>
        bridge
          .call("settings.setDeathAdsVisible", [visible])
          .pipe(
            Effect.flatMap(() => state.patch({ deathAdsVisible: visible })),
          ),
      setEnemyMagnetEnabled: (enabled) =>
        state.patch({ enemyMagnetEnabled: enabled }),
      setFrameRate: (fps) => {
        const normalized = clamp(fps, 1, 120);
        return bridge
          .call("settings.setFrameRate", [normalized])
          .pipe(Effect.flatMap(() => state.patch({ frameRate: normalized })));
      },
      setInfiniteRangeEnabled: (enabled) =>
        state.patch({ infiniteRangeEnabled: enabled }),
      setLagKillerEnabled: (enabled) =>
        bridge
          .call("settings.setLagKillerEnabled", [enabled])
          .pipe(
            Effect.flatMap(() => state.patch({ lagKillerEnabled: enabled })),
          ),
      setOtherPlayersVisible: (visible) =>
        bridge
          .call("settings.setOtherPlayersVisible", [visible])
          .pipe(
            Effect.flatMap(() => state.patch({ otherPlayersVisible: visible })),
          ),
      setProvokeCellEnabled: (enabled) =>
        state.patch({ provokeCellEnabled: enabled }),
      setSkipCutscenesEnabled: (enabled) =>
        state.patch({ skipCutscenesEnabled: enabled }),
      setWalkSpeed: (speed) => {
        const normalized = clamp(speed, 1, 100);
        return bridge
          .call("settings.setWalkSpeed", [normalized])
          .pipe(Effect.flatMap(() => state.patch({ walkSpeed: normalized })));
      },
      skipCutscenes,
    });
  }),
);
