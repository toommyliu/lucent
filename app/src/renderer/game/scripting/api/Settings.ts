import { Effect } from "effect";

import type { ApiService } from "../../flash/api/Api";

export interface ScriptSettingsApi {
  readonly isAntiCounterEnabled: () => Effect.Effect<boolean>;
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
}

export const makeScriptSettingsApi = (
  settings: ApiService["settings"],
): ScriptSettingsApi =>
  Object.freeze({
    isAntiCounterEnabled: settings.isAntiCounterEnabled,
    setAnimationsEnabled: settings.setAnimationsEnabled,
    setAntiCounterEnabled: settings.setAntiCounterEnabled,
    setCollisionsEnabled: settings.setCollisionsEnabled,
    setCustomGuild: settings.setCustomGuild,
    setCustomName: settings.setCustomName,
    setDeathAdsVisible: settings.setDeathAdsVisible,
    setEnemyMagnetEnabled: settings.setEnemyMagnetEnabled,
    setFrameRate: settings.setFrameRate,
    setInfiniteRangeEnabled: settings.setInfiniteRangeEnabled,
    setLagKillerEnabled: settings.setLagKillerEnabled,
    setOtherPlayersVisible: settings.setOtherPlayersVisible,
    setProvokeCellEnabled: settings.setProvokeCellEnabled,
    setSkipCutscenesEnabled: settings.setSkipCutscenesEnabled,
    setWalkSpeed: settings.setWalkSpeed,
  });
