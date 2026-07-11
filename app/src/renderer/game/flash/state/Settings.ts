export interface SettingsState {
  animationsEnabled: boolean;
  antiCounterEnabled: boolean;
  collisionsEnabled: boolean;
  customGuild: string;
  customName: string;
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
