import { Schema } from "effect";

export const COMBAT_PROFILE_LIBRARY_VERSION = 1 as const;

export const DEFAULT_COMBAT_PROFILE_ID = "generic-base";
export const DEFAULT_COMBAT_PROFILE_ROLE = "Base";
export const DEFAULT_COMBAT_PROFILE_DELAY_MS = 150;

export const CombatProfileCooldownModes = [
  "use-if-ready",
  "wait-for-cooldown",
] as const;

export type CombatProfileCooldownMode =
  (typeof CombatProfileCooldownModes)[number];

export type CombatProfileThresholdUnit = "percent" | "value";
export type CombatProfileComparison = "<=" | ">=";

export type CombatProfileStatCondition = {
  readonly type: "self-hp" | "self-mp" | "ally-hp";
  readonly op: CombatProfileComparison;
  readonly value: number;
  readonly unit: CombatProfileThresholdUnit;
};

export type CombatProfileAuraCondition = {
  readonly type: "self-aura" | "target-aura";
  readonly auraName: string;
  readonly op: CombatProfileComparison;
  readonly value: number;
};

export type CombatProfileCondition =
  | CombatProfileStatCondition
  | CombatProfileAuraCondition;

export interface CombatProfileStep {
  readonly id: string;
  readonly skill: number;
  readonly conditions: readonly CombatProfileCondition[];
  readonly cooldownMode?: CombatProfileCooldownMode;
  readonly waitMs?: number;
}

export type CombatProfileMessageTriggerSource = "any" | "animation" | "aura";

export interface CombatProfileMessageTrigger {
  readonly id: string;
  readonly messageIncludes: string;
  readonly skill: number;
  readonly source: CombatProfileMessageTriggerSource;
  readonly cooldownMs?: number;
}

export interface CombatProfile {
  readonly id: string;
  readonly label: string;
  readonly className?: string;
  readonly role: string;
  readonly delayMs: number;
  readonly cooldownMode: CombatProfileCooldownMode;
  readonly resetSkillIndexOnMonsterDeath?: boolean;
  readonly steps: readonly CombatProfileStep[];
  readonly messageTriggers?: readonly CombatProfileMessageTrigger[];
}

export type CombatProfileStepDefinition = Partial<CombatProfileStep> & {
  readonly skill: number;
};

export type CombatProfileMessageTriggerDefinition =
  Partial<CombatProfileMessageTrigger> & {
    readonly messageIncludes: string;
    readonly skill: number;
  };

export interface CombatProfileDefinition extends Partial<
  Omit<CombatProfile, "steps" | "messageTriggers">
> {
  readonly steps: readonly CombatProfileStepDefinition[];
  readonly messageTriggers?: readonly CombatProfileMessageTriggerDefinition[];
}

export interface CombatProfileLibrary {
  readonly version: typeof COMBAT_PROFILE_LIBRARY_VERSION;
  readonly profiles: readonly CombatProfile[];
}

export const CombatProfileCooldownModeSchema = Schema.Literals(
  CombatProfileCooldownModes,
);

export const CombatProfileThresholdUnitSchema = Schema.Literals([
  "percent",
  "value",
]);

export const CombatProfileComparisonSchema = Schema.Literals(["<=", ">="]);

export const CombatProfileStatConditionSchema = Schema.Struct({
  type: Schema.Literals(["self-hp", "self-mp", "ally-hp"]),
  op: CombatProfileComparisonSchema,
  value: Schema.Number,
  unit: CombatProfileThresholdUnitSchema,
});

export const CombatProfileAuraConditionSchema = Schema.Struct({
  type: Schema.Literals(["self-aura", "target-aura"]),
  auraName: Schema.String,
  op: CombatProfileComparisonSchema,
  value: Schema.Number,
});

export const CombatProfileConditionSchema = Schema.Union([
  CombatProfileStatConditionSchema,
  CombatProfileAuraConditionSchema,
]);

export const CombatProfileStepSchema = Schema.Struct({
  id: Schema.String,
  skill: Schema.Number,
  conditions: Schema.Array(CombatProfileConditionSchema),
  cooldownMode: Schema.optionalKey(CombatProfileCooldownModeSchema),
  waitMs: Schema.optionalKey(Schema.Number),
});

export const CombatProfileMessageTriggerSourceSchema = Schema.Literals([
  "any",
  "animation",
  "aura",
]);

export const CombatProfileMessageTriggerSchema = Schema.Struct({
  id: Schema.String,
  messageIncludes: Schema.String,
  skill: Schema.Number,
  source: CombatProfileMessageTriggerSourceSchema,
  cooldownMs: Schema.optionalKey(Schema.Number),
});

export const CombatProfileSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  className: Schema.optionalKey(Schema.String),
  role: Schema.String,
  delayMs: Schema.Number,
  cooldownMode: CombatProfileCooldownModeSchema,
  resetSkillIndexOnMonsterDeath: Schema.optionalKey(Schema.Boolean),
  steps: Schema.Array(CombatProfileStepSchema),
  messageTriggers: Schema.optionalKey(
    Schema.Array(CombatProfileMessageTriggerSchema),
  ),
});

export const CombatProfileLibrarySchema = Schema.Struct({
  version: Schema.Literal(COMBAT_PROFILE_LIBRARY_VERSION),
  profiles: Schema.Array(CombatProfileSchema),
});
