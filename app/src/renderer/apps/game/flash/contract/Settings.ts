import { Schema } from "effect";

export const Settings = Schema.Struct({
  animationsEnabled: Schema.Boolean,
  antiCounterEnabled: Schema.Boolean,
  collisionsEnabled: Schema.Boolean,
  customGuild: Schema.String,
  customGuildConfigured: Schema.Boolean,
  customName: Schema.String,
  customNameConfigured: Schema.Boolean,
  deathAdsVisible: Schema.Boolean,
  enemyMagnetEnabled: Schema.Boolean,
  frameRate: Schema.Int,
  infiniteRangeEnabled: Schema.Boolean,
  lagKillerEnabled: Schema.Boolean,
  otherPlayersVisible: Schema.Boolean,
  provokeCellEnabled: Schema.Boolean,
  skipCutscenesEnabled: Schema.Boolean,
  walkSpeed: Schema.Int,
});
export type Settings = typeof Settings.Type;

export const SettingsPatch = Schema.Struct({
  animationsEnabled: Schema.optionalKey(Schema.Boolean),
  antiCounterEnabled: Schema.optionalKey(Schema.Boolean),
  collisionsEnabled: Schema.optionalKey(Schema.Boolean),
  customGuild: Schema.optionalKey(Schema.String),
  customName: Schema.optionalKey(Schema.String),
  deathAdsVisible: Schema.optionalKey(Schema.Boolean),
  enemyMagnetEnabled: Schema.optionalKey(Schema.Boolean),
  frameRate: Schema.optionalKey(Schema.Int),
  infiniteRangeEnabled: Schema.optionalKey(Schema.Boolean),
  lagKillerEnabled: Schema.optionalKey(Schema.Boolean),
  otherPlayersVisible: Schema.optionalKey(Schema.Boolean),
  provokeCellEnabled: Schema.optionalKey(Schema.Boolean),
  skipCutscenesEnabled: Schema.optionalKey(Schema.Boolean),
  walkSpeed: Schema.optionalKey(Schema.Int),
});
export type SettingsPatch = typeof SettingsPatch.Type;
