import { Context, Effect, Layer, SynchronizedRef } from "effect";

import type { FlashSettingsSnapshot } from "../Types";

const defaultSettings = (): FlashSettingsSnapshot => ({
  animationsEnabled: true,
  antiCounterEnabled: true,
  collisionsEnabled: true,
  customGuild: "",
  customName: "",
  deathAdsVisible: true,
  enemyMagnetEnabled: false,
  frameRate: 30,
  infiniteRangeEnabled: false,
  lagKillerEnabled: false,
  otherPlayersVisible: true,
  provokeCellEnabled: false,
  skipCutscenesEnabled: false,
  walkSpeed: 8,
});

export interface SettingsStateShape {
  readonly get: Effect.Effect<FlashSettingsSnapshot>;
  readonly patch: (
    patch: Partial<FlashSettingsSnapshot>,
  ) => Effect.Effect<void>;
}

export class SettingsState extends Context.Service<
  SettingsState,
  SettingsStateShape
>()("lucent/game/flash/state/Settings") {}

export const layer = Layer.effect(
  SettingsState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make(defaultSettings());

    return SettingsState.of({
      get: SynchronizedRef.get(ref),
      patch: (patch) =>
        SynchronizedRef.update(ref, (state) => ({
          ...state,
          ...patch,
        })),
    });
  }),
);
