import { Context, Effect, Layer, SynchronizedRef } from "effect";

import {
  makeStateListeners,
  type StateDisposer,
  type StateSubscriptionOptions,
} from "../StateListeners";
import type { FlashSettingsPatch, FlashSettingsSnapshot } from "../Types";

const defaultSettings = (): FlashSettingsSnapshot => ({
  animationsEnabled: true,
  antiCounterEnabled: true,
  collisionsEnabled: true,
  customGuild: "",
  customName: "",
  deathAdsVisible: true,
  enemyMagnetEnabled: false,
  frameRate: 24,
  infiniteRangeEnabled: false,
  lagKillerEnabled: false,
  otherPlayersVisible: true,
  provokeCellEnabled: false,
  skipCutscenesEnabled: false,
  walkSpeed: 8,
});

const clampInteger = (
  value: number,
  min: number,
  max: number,
  fallback: number,
): number =>
  Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;

const cloneSettings = (
  settings: FlashSettingsSnapshot,
): FlashSettingsSnapshot => ({
  ...settings,
});

const hasPatchKeys = (patch: FlashSettingsPatch): boolean =>
  Object.keys(patch).length > 0;

export const normalizeSettingsPatch = (
  patch: FlashSettingsPatch,
): FlashSettingsPatch => {
  const normalized: FlashSettingsPatch = {};

  if (patch.animationsEnabled !== undefined) {
    normalized.animationsEnabled = patch.animationsEnabled;
  }

  if (patch.antiCounterEnabled !== undefined) {
    normalized.antiCounterEnabled = patch.antiCounterEnabled;
  }

  if (patch.collisionsEnabled !== undefined) {
    normalized.collisionsEnabled = patch.collisionsEnabled;
  }

  if (patch.customGuild !== undefined) {
    normalized.customGuild = patch.customGuild.trim();
  }

  if (patch.customName !== undefined) {
    normalized.customName = patch.customName.trim();
  }

  if (patch.deathAdsVisible !== undefined) {
    normalized.deathAdsVisible = patch.deathAdsVisible;
  }

  if (patch.enemyMagnetEnabled !== undefined) {
    normalized.enemyMagnetEnabled = patch.enemyMagnetEnabled;
  }

  if (patch.frameRate !== undefined) {
    normalized.frameRate = clampInteger(
      patch.frameRate,
      1,
      60,
      defaultSettings().frameRate,
    );
  }

  if (patch.infiniteRangeEnabled !== undefined) {
    normalized.infiniteRangeEnabled = patch.infiniteRangeEnabled;
  }

  if (patch.lagKillerEnabled !== undefined) {
    normalized.lagKillerEnabled = patch.lagKillerEnabled;
  }

  if (patch.otherPlayersVisible !== undefined) {
    normalized.otherPlayersVisible = patch.otherPlayersVisible;
  }

  if (patch.provokeCellEnabled !== undefined) {
    normalized.provokeCellEnabled = patch.provokeCellEnabled;
  }

  if (patch.skipCutscenesEnabled !== undefined) {
    normalized.skipCutscenesEnabled = patch.skipCutscenesEnabled;
  }

  if (patch.walkSpeed !== undefined) {
    normalized.walkSpeed = clampInteger(
      patch.walkSpeed,
      1,
      100,
      defaultSettings().walkSpeed,
    );
  }

  return normalized;
};

export interface SettingsStateShape {
  readonly get: () => Effect.Effect<FlashSettingsSnapshot>;
  readonly onState: (
    listener: (state: FlashSettingsSnapshot) => void,
    options?: StateSubscriptionOptions,
  ) => Effect.Effect<StateDisposer>;
  readonly patch: (
    patch: FlashSettingsPatch,
  ) => Effect.Effect<FlashSettingsSnapshot>;
}

export class SettingsState extends Context.Service<
  SettingsState,
  SettingsStateShape
>()("lucent/game/flash/state/Settings") {}

export const layer = Layer.effect(
  SettingsState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make(defaultSettings());
    const listeners = makeStateListeners<FlashSettingsSnapshot>("settings");
    const get = () => SynchronizedRef.get(ref).pipe(Effect.map(cloneSettings));

    return SettingsState.of({
      get,
      onState: (listener, options) => listeners.on(get(), listener, options),
      patch: (patch) =>
        Effect.gen(function* () {
          const normalized = normalizeSettingsPatch(patch);
          if (!hasPatchKeys(normalized)) {
            return yield* get();
          }

          const result = yield* SynchronizedRef.modify(ref, (state) => {
            let changed = false;
            const next = { ...state };

            for (const [key, value] of Object.entries(normalized)) {
              const setting = key as keyof FlashSettingsSnapshot;
              if (next[setting] === value) {
                continue;
              }

              changed = true;
              Object.assign(next, { [setting]: value });
            }

            return [
              {
                changed,
                state: cloneSettings(changed ? next : state),
              },
              changed ? next : state,
            ] as const;
          });

          if (result.changed) {
            yield* listeners.emit(result.state);
          }

          return result.state;
        }),
    });
  }),
);
