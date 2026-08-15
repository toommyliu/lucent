import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { boundedInt, TrimmedNonEmptyString } from "./baseSchemas";

export const COMBAT_PROFILE_LIBRARY_VERSION = 2 as const;

export const DEFAULT_COMBAT_PROFILE_ID = "generic-base";
export const DEFAULT_COMBAT_PROFILE_ROLE = "Base";
export const DEFAULT_COMBAT_PROFILE_DELAY_MS = 150;

const MAX_DELAY_MS = 60_000;
const MAX_WAIT_MS = 60_000;
const MAX_ID_LENGTH = 80;
const MAX_LABEL_LENGTH = 80;
const MAX_ROLE_LENGTH = 40;
const MAX_CLASS_NAME_LENGTH = 80;
const MAX_CONSUMABLE_NAME_LENGTH = 80;
const MAX_AURA_NAME_LENGTH = 80;
const MAX_MESSAGE_TRIGGER_TEXT_LENGTH = 160;

export const CombatProfileCooldownModeSchema = Schema.Literals([
  "use-if-ready",
  "wait-for-cooldown",
]);
export type CombatProfileCooldownMode =
  typeof CombatProfileCooldownModeSchema.Type;

export const CombatProfileThresholdUnitSchema = Schema.Literals([
  "percent",
  "value",
]);
export type CombatProfileThresholdUnit =
  typeof CombatProfileThresholdUnitSchema.Type;

export const CombatProfileComparisonSchema = Schema.Literals(["<=", ">="]);
export type CombatProfileComparison = typeof CombatProfileComparisonSchema.Type;

export const CombatProfileStatConditionSchema = Schema.Struct({
  type: Schema.Literals(["self-hp", "self-mp", "ally-hp"]),
  op: CombatProfileComparisonSchema,
  value: boundedInt(0, 999_999),
  unit: CombatProfileThresholdUnitSchema,
});
export type CombatProfileStatCondition =
  typeof CombatProfileStatConditionSchema.Type;

export const CombatProfileAuraConditionSchema = Schema.Struct({
  type: Schema.Literals(["self-aura", "target-aura"]),
  auraName: TrimmedNonEmptyString,
  op: CombatProfileComparisonSchema,
  value: boundedInt(0, 999),
});
export type CombatProfileAuraCondition =
  typeof CombatProfileAuraConditionSchema.Type;

export const CombatProfileConditionSchema = Schema.Union([
  CombatProfileStatConditionSchema,
  CombatProfileAuraConditionSchema,
]);
export type CombatProfileCondition = typeof CombatProfileConditionSchema.Type;

export const CombatProfileStepSchema = Schema.Struct({
  skill: boundedInt(0, 5),
  conditions: Schema.Array(CombatProfileConditionSchema),
  priority: Schema.optionalKey(Schema.Boolean),
  cooldownMode: Schema.optionalKey(CombatProfileCooldownModeSchema),
  waitMs: Schema.optionalKey(boundedInt(0, MAX_WAIT_MS)),
});
export type CombatProfileStep = typeof CombatProfileStepSchema.Type;

export const CombatProfileMessageTriggerSourceSchema = Schema.Literals([
  "any",
  "animation",
  "aura",
]);
export type CombatProfileMessageTriggerSource =
  typeof CombatProfileMessageTriggerSourceSchema.Type;

export const CombatProfileMessageTriggerSchema = Schema.Struct({
  messageIncludes: TrimmedNonEmptyString,
  skill: boundedInt(0, 5),
  source: CombatProfileMessageTriggerSourceSchema,
  cooldownMs: Schema.optionalKey(boundedInt(0, MAX_WAIT_MS)),
});
export type CombatProfileMessageTrigger =
  typeof CombatProfileMessageTriggerSchema.Type;

export const CombatProfileSchema = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  className: Schema.optionalKey(TrimmedNonEmptyString),
  consumable: Schema.optionalKey(TrimmedNonEmptyString),
  role: TrimmedNonEmptyString,
  delayMs: boundedInt(0, MAX_DELAY_MS),
  cooldownMode: CombatProfileCooldownModeSchema,
  resetSkillIndexOnMonsterDeath: Schema.optionalKey(Schema.Boolean),
  steps: Schema.Array(CombatProfileStepSchema),
  messageTriggers: Schema.optionalKey(
    Schema.Array(CombatProfileMessageTriggerSchema),
  ),
});
export type CombatProfile = typeof CombatProfileSchema.Type;

export const CombatProfileLibrarySchema = Schema.Struct({
  version: Schema.Literal(COMBAT_PROFILE_LIBRARY_VERSION),
  profiles: Schema.Array(CombatProfileSchema),
});
export type CombatProfileLibrary = typeof CombatProfileLibrarySchema.Type;

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

export class CombatProfileNormalizationError extends Error {
  readonly _tag = "CombatProfileNormalizationError";

  constructor(message: string) {
    super(message);
    this.name = "CombatProfileNormalizationError";
  }
}

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const CombatProfileDefinitionInputSchema = Schema.Struct({
  steps: Schema.Array(Schema.Unknown),
});

type UnknownRecord = typeof UnknownRecordSchema.Type;

const decodeArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const decodeCombatProfileComparison = Schema.decodeUnknownOption(
  CombatProfileComparisonSchema,
);
const decodeCombatProfileCooldownMode = Schema.decodeUnknownOption(
  CombatProfileCooldownModeSchema,
);
const decodeCombatProfileDefinitionInput = Schema.decodeUnknownOption(
  CombatProfileDefinitionInputSchema,
);
const decodeCombatProfileMessageTriggerSource = Schema.decodeUnknownOption(
  CombatProfileMessageTriggerSourceSchema,
);
const decodeCombatProfileThresholdUnit = Schema.decodeUnknownOption(
  CombatProfileThresholdUnitSchema,
);
const decodeFinite = Schema.decodeUnknownOption(Schema.Finite);
const decodeRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const decodeString = Schema.decodeUnknownOption(Schema.String);

const fromOption = <A>(
  decode: (value: unknown) => Option.Option<A>,
  value: unknown,
): A | undefined => {
  const decoded = decode(value);
  return Option.isSome(decoded) ? decoded.value : undefined;
};

const asRecord = (value: unknown): UnknownRecord | undefined =>
  fromOption(decodeRecord, value);

const asArray = (value: unknown): readonly unknown[] =>
  fromOption(decodeArray, value) ?? [];

const normalizeArray = <T>(
  value: unknown,
  normalize: (value: unknown, index: number) => T | undefined,
): readonly T[] =>
  asArray(value)
    .map(normalize)
    .filter((value): value is T => value !== undefined);

const clampInt = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = fromOption(decodeFinite, value);
  return parsed === undefined
    ? fallback
    : Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const truncateUtf16 = (value: string, maxLength: number): string => {
  const truncated = value.slice(0, maxLength);
  const last = truncated.charCodeAt(truncated.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? truncated.slice(0, -1) : truncated;
};

const trimString = (value: unknown, maxLength: number): string | undefined => {
  const decoded = fromOption(decodeString, value);
  if (decoded === undefined) {
    return undefined;
  }

  const trimmed = decoded.trim();
  const truncated = truncateUtf16(trimmed, maxLength);
  return truncated === "" ? undefined : truncated;
};

const appendIdSuffix = (id: string, suffix: number): string => {
  const suffixText = `-${suffix}`;
  return `${truncateUtf16(id, MAX_ID_LENGTH - suffixText.length)}${suffixText}`;
};

const ensureUniqueIds = <T extends { readonly id: string }>(
  values: readonly T[],
): readonly T[] => {
  const reservedIds = new Set(values.map((value) => value.id));
  const usedIds = new Set<string>();
  const nextSuffixes = new Map<string, number>();

  return values.map((value) => {
    if (!usedIds.has(value.id)) {
      usedIds.add(value.id);
      return value;
    }

    let suffix = nextSuffixes.get(value.id) ?? 2;
    let id = appendIdSuffix(value.id, suffix);
    while (reservedIds.has(id) || usedIds.has(id)) {
      suffix += 1;
      id = appendIdSuffix(value.id, suffix);
    }

    nextSuffixes.set(value.id, suffix + 1);
    usedIds.add(id);
    return { ...value, id };
  });
};

const genericProfile = (): CombatProfile => ({
  id: DEFAULT_COMBAT_PROFILE_ID,
  label: "Generic",
  role: DEFAULT_COMBAT_PROFILE_ROLE,
  delayMs: DEFAULT_COMBAT_PROFILE_DELAY_MS,
  cooldownMode: "use-if-ready",
  steps: [1, 2, 3, 4].map((skill) => ({
    skill,
    conditions: [],
  })),
});

const normalizeCondition = (
  value: unknown,
): CombatProfileCondition | undefined => {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const type = record["type"];
  if (type === "self-hp" || type === "self-mp" || type === "ally-hp") {
    const unit =
      fromOption(decodeCombatProfileThresholdUnit, record["unit"]) ?? "percent";
    return {
      type,
      op: fromOption(decodeCombatProfileComparison, record["op"]) ?? "<=",
      value: clampInt(
        record["value"],
        0,
        0,
        unit === "percent" ? 100 : 999_999,
      ),
      unit,
    };
  }

  if (type !== "self-aura" && type !== "target-aura") {
    return undefined;
  }

  const auraName = trimString(record["auraName"], MAX_AURA_NAME_LENGTH);
  return auraName === undefined
    ? undefined
    : {
        type,
        auraName,
        op: fromOption(decodeCombatProfileComparison, record["op"]) ?? "<=",
        value: clampInt(record["value"], 0, 0, 999),
      };
};

const normalizeStep = (value: unknown): CombatProfileStep | undefined => {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const skill = clampInt(record["skill"], Number.NaN, 0, 5);
  if (!Number.isFinite(skill)) {
    return undefined;
  }

  const cooldownMode = fromOption(
    decodeCombatProfileCooldownMode,
    record["cooldownMode"],
  );
  const legacyCooldownMode =
    fromOption(decodeBoolean, record["skipIfUnavailable"]) === true
      ? "use-if-ready"
      : undefined;
  const waitMs = clampInt(record["waitMs"], 0, 0, MAX_WAIT_MS);

  return {
    skill,
    conditions: normalizeArray(record["conditions"], normalizeCondition),
    ...(fromOption(decodeBoolean, record["priority"])
      ? { priority: true }
      : {}),
    ...(cooldownMode === undefined
      ? legacyCooldownMode === undefined
        ? {}
        : { cooldownMode: legacyCooldownMode }
      : { cooldownMode }),
    ...(waitMs > 0 ? { waitMs } : {}),
  };
};

const normalizeMessageTrigger = (
  value: unknown,
): CombatProfileMessageTrigger | undefined => {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const messageIncludes = trimString(
    record["messageIncludes"],
    MAX_MESSAGE_TRIGGER_TEXT_LENGTH,
  );
  const skill = clampInt(record["skill"], Number.NaN, 0, 5);
  if (messageIncludes === undefined || !Number.isFinite(skill)) {
    return undefined;
  }

  const cooldownMs = clampInt(record["cooldownMs"], 0, 0, MAX_WAIT_MS);
  return {
    messageIncludes,
    skill,
    source:
      fromOption(decodeCombatProfileMessageTriggerSource, record["source"]) ??
      "any",
    ...(cooldownMs > 0 ? { cooldownMs } : {}),
  };
};

const normalizeProfile = (
  value: unknown,
  fallbackId?: string,
): CombatProfile | undefined => {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const id = trimString(record["id"], MAX_ID_LENGTH) ?? fallbackId;
  if (id === undefined) {
    return undefined;
  }

  const label = trimString(record["label"], MAX_LABEL_LENGTH) ?? "Profile";
  const className = trimString(record["className"], MAX_CLASS_NAME_LENGTH);
  const consumable = trimString(
    record["consumable"],
    MAX_CONSUMABLE_NAME_LENGTH,
  );
  const messageTriggers = normalizeArray(
    record["messageTriggers"],
    normalizeMessageTrigger,
  );
  const steps = normalizeArray(record["steps"], normalizeStep);
  const normalizedSteps =
    steps.length === 0
      ? (structuredClone(
          genericProfile().steps,
        ) as readonly CombatProfileStep[])
      : steps;

  return {
    id,
    label,
    ...(className === undefined ? {} : { className }),
    ...(consumable === undefined ? {} : { consumable }),
    role:
      trimString(record["role"], MAX_ROLE_LENGTH) ??
      DEFAULT_COMBAT_PROFILE_ROLE,
    delayMs: clampInt(
      record["delayMs"],
      DEFAULT_COMBAT_PROFILE_DELAY_MS,
      0,
      MAX_DELAY_MS,
    ),
    cooldownMode:
      fromOption(decodeCombatProfileCooldownMode, record["cooldownMode"]) ??
      "use-if-ready",
    ...(fromOption(decodeBoolean, record["resetSkillIndexOnMonsterDeath"])
      ? { resetSkillIndexOnMonsterDeath: true }
      : {}),
    steps: normalizedSteps,
    ...(messageTriggers.length === 0 ? {} : { messageTriggers }),
  };
};

const normalizeProfiles = (value: unknown): readonly CombatProfile[] => {
  const profiles = [
    ...normalizeArray(value, (profile) => normalizeProfile(profile)),
  ];
  const genericIndex = profiles.findIndex(
    (profile) => profile.id === DEFAULT_COMBAT_PROFILE_ID,
  );

  if (genericIndex === -1) {
    profiles.unshift(genericProfile());
  } else if (genericIndex > 0) {
    const [generic] = profiles.splice(genericIndex, 1);
    profiles.unshift(generic!);
  }
  return ensureUniqueIds(profiles);
};

const assertSupportedLibraryVersion = (version: unknown): void => {
  const parsed = fromOption(decodeFinite, version);
  if (
    parsed !== undefined &&
    Number.isInteger(parsed) &&
    parsed > COMBAT_PROFILE_LIBRARY_VERSION
  ) {
    throw new CombatProfileNormalizationError(
      `Unsupported combat profile library version ${parsed}`,
    );
  }
};

export const DEFAULT_COMBAT_PROFILE_LIBRARY: CombatProfileLibrary = {
  version: COMBAT_PROFILE_LIBRARY_VERSION,
  profiles: [genericProfile()],
};

export const cloneCombatProfileLibrary = (
  library: CombatProfileLibrary,
): CombatProfileLibrary => structuredClone(library) as CombatProfileLibrary;

export const normalizeCombatProfile = (value: unknown): CombatProfile =>
  normalizeProfile(value, DEFAULT_COMBAT_PROFILE_ID) ?? genericProfile();

export const isCombatProfileDefinition = (
  value: unknown,
): value is CombatProfileDefinition =>
  Option.isSome(decodeCombatProfileDefinitionInput(value));

export const normalizeCombatProfileLibrary = (
  value: unknown,
): CombatProfileLibrary => {
  const source = asRecord(value);
  assertSupportedLibraryVersion(source?.["version"]);

  return {
    version: COMBAT_PROFILE_LIBRARY_VERSION,
    profiles: normalizeProfiles(source?.["profiles"]),
  };
};

export const findCombatProfileById = (
  library: CombatProfileLibrary,
  profileId: string,
): CombatProfile | undefined =>
  library.profiles.find((profile) => profile.id === profileId);

const getDuplicateCombatProfileLabel = (
  label: string,
  profiles: readonly CombatProfile[],
): string => {
  const labels = new Set(profiles.map((profile) => profile.label));
  const copyLabel = `${label} Copy`;
  if (!labels.has(copyLabel)) {
    return copyLabel;
  }

  let index = 2;
  while (labels.has(`${copyLabel} ${index}`)) {
    index += 1;
  }
  return `${copyLabel} ${index}`;
};

export const duplicateCombatProfile = (
  profile: CombatProfile,
  profiles: readonly CombatProfile[],
  createId: () => string,
): CombatProfile => ({
  ...profile,
  id: createId(),
  label: getDuplicateCombatProfileLabel(profile.label, profiles),
  steps: profile.steps.map((step) => ({
    ...step,
    conditions: step.conditions.map((condition) => ({ ...condition })),
  })),
  ...(profile.messageTriggers === undefined
    ? {}
    : {
        messageTriggers: profile.messageTriggers.map((trigger) => ({
          ...trigger,
        })),
      }),
});

export const getCombatProfileById = (
  library: CombatProfileLibrary,
  profileId: string,
): CombatProfile =>
  findCombatProfileById(library, profileId) ??
  findCombatProfileById(library, DEFAULT_COMBAT_PROFILE_ID) ??
  genericProfile();

export const serializeCombatProfileLibrary = (
  library: CombatProfileLibrary,
): CombatProfileLibrary => normalizeCombatProfileLibrary(library);
