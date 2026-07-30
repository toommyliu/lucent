import type { ApiService } from "../../flash/api/Api";
import type { ScriptSettingsApi } from "../ScriptApi";

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
