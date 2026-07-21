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
  lagKillerEnabled: boolean;
  otherPlayersVisible: boolean;
  provokeCellEnabled: boolean;
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
  lagKillerEnabled: false,
  otherPlayersVisible: true,
  provokeCellEnabled: false,
  skipCutscenesEnabled: false,
  walkSpeed: 8,
});
