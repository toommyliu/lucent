import type { RenderingMode } from "../contract/Settings";

export interface SettingsState {
  animationsEnabled: boolean;
  antiCounterEnabled: boolean;
  collisionsEnabled: boolean;
  customGuild: string;
  customGuildConfigured: boolean;
  customName: string;
  customNameConfigured: boolean;
  deathAdsVisible: boolean;
  enemyMagnetEnabled: boolean;
  frameRate: number;
  infiniteRangeEnabled: boolean;
  otherPlayersVisible: boolean;
  provokeCellEnabled: boolean;
  renderingMode: RenderingMode;
  skipCutscenesEnabled: boolean;
  walkSpeed: number;
}

export const makeSettingsState = (): SettingsState => ({
  animationsEnabled: true,
  antiCounterEnabled: true,
  collisionsEnabled: true,
  customGuild: "",
  customGuildConfigured: false,
  customName: "",
  customNameConfigured: false,
  deathAdsVisible: true,
  enemyMagnetEnabled: false,
  frameRate: 24,
  infiniteRangeEnabled: false,
  otherPlayersVisible: true,
  provokeCellEnabled: false,
  renderingMode: "full",
  skipCutscenesEnabled: false,
  walkSpeed: 8,
});
