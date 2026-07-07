import { Option, Schema } from "effect";

import {
  COMBAT_PROFILE_LIBRARY_VERSION,
  CombatProfileComparisonSchema,
  CombatProfileCooldownModeSchema,
  CombatProfileMessageTriggerSourceSchema,
  CombatProfileThresholdUnitSchema,
  DEFAULT_COMBAT_PROFILE_DELAY_MS,
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_ROLE,
  type CombatProfile,
  type CombatProfileComparison,
  type CombatProfileCondition,
  type CombatProfileCooldownMode,
  type CombatProfileDefinition,
  type CombatProfileLibrary,
  type CombatProfileMessageTrigger,
  type CombatProfileMessageTriggerSource,
  type CombatProfileStep,
  type CombatProfileThresholdUnit,
} from "./combat-profile-model";

const profileIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const MAX_DELAY_MS = 60_000;
const MAX_WAIT_MS = 60_000;
const MAX_LABEL_LENGTH = 80;
const MAX_ROLE_LENGTH = 40;
const MAX_CLASS_NAME_LENGTH = 80;
const MAX_AURA_NAME_LENGTH = 80;
const MAX_MESSAGE_TRIGGER_TEXT_LENGTH = 160;

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

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const normalizeArray = <T>(
  value: unknown,
  normalize: (value: unknown, index: number) => T | undefined,
): readonly T[] => asArray(value).map(normalize).filter(isDefined);

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

const trimString = (value: unknown, maxLength: number): string | undefined => {
  const decoded = fromOption(decodeString, value);
  if (decoded === undefined) {
    return undefined;
  }

  const trimmed = decoded.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, maxLength);
};

export const makeCombatProfileId = (label: string): string => {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/['"]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized === "" ? "profile" : normalized;
};

const genericProfile = (): CombatProfile => ({
  id: DEFAULT_COMBAT_PROFILE_ID,
  label: "Generic",
  role: DEFAULT_COMBAT_PROFILE_ROLE,
  delayMs: DEFAULT_COMBAT_PROFILE_DELAY_MS,
  cooldownMode: "use-if-ready",
  steps: [1, 2, 3, 4].map((skill) => ({
    id: `generic-${skill}`,
    skill,
    conditions: [],
  })),
  messageTriggers: [],
});

const normalizeComparison = (value: unknown): CombatProfileComparison =>
  fromOption(decodeCombatProfileComparison, value) ?? "<=";

const normalizeThresholdUnit = (value: unknown): CombatProfileThresholdUnit =>
  fromOption(decodeCombatProfileThresholdUnit, value) ?? "percent";

const normalizeCooldownMode = (value: unknown): CombatProfileCooldownMode =>
  fromOption(decodeCombatProfileCooldownMode, value) ?? "use-if-ready";

const normalizeMessageTriggerSource = (
  value: unknown,
): CombatProfileMessageTriggerSource =>
  fromOption(decodeCombatProfileMessageTriggerSource, value) ?? "any";

const normalizeProfileId = (
  value: unknown,
  fallbackLabel: string,
  reservedIds: ReadonlySet<string>,
): string => {
  const explicit = trimString(value, 80);
  const base =
    explicit !== undefined && profileIdPattern.test(explicit)
      ? explicit
      : makeCombatProfileId(fallbackLabel);

  if (!reservedIds.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!reservedIds.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${Date.now()}`;
};

const normalizeCondition = (
  value: unknown,
): CombatProfileCondition | undefined => {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const type = record["type"];
  if (type === "self-hp" || type === "self-mp" || type === "ally-hp") {
    const unit = normalizeThresholdUnit(record["unit"]);
    return {
      type,
      op: normalizeComparison(record["op"]),
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
        op: normalizeComparison(record["op"]),
        value: clampInt(record["value"], 0, 0, 999),
      };
};

const normalizeStep = (
  value: unknown,
  index: number,
): CombatProfileStep | undefined => {
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
    id: trimString(record["id"], 80) ?? `step-${index + 1}`,
    skill,
    conditions: normalizeArray(record["conditions"], normalizeCondition),
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
  index: number,
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
    id: trimString(record["id"], 80) ?? `trigger-${index + 1}`,
    messageIncludes,
    skill,
    source: normalizeMessageTriggerSource(record["source"]),
    ...(cooldownMs > 0 ? { cooldownMs } : {}),
  };
};

const cloneGenericSteps = (): readonly CombatProfileStep[] =>
  genericProfile().steps.map((step) => Object.assign({}, step));

const normalizeProfile = (
  value: unknown,
  reservedIds: Set<string>,
): CombatProfile | undefined => {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const label = trimString(record["label"], MAX_LABEL_LENGTH) ?? "Profile";
  const id = normalizeProfileId(record["id"], label, reservedIds);
  reservedIds.add(id);

  const className = trimString(record["className"], MAX_CLASS_NAME_LENGTH);
  const messageTriggers = normalizeArray(
    record["messageTriggers"],
    normalizeMessageTrigger,
  );
  const steps = normalizeArray(record["steps"], normalizeStep);

  return {
    id,
    label,
    ...(className === undefined ? {} : { className }),
    role:
      trimString(record["role"], MAX_ROLE_LENGTH) ??
      DEFAULT_COMBAT_PROFILE_ROLE,
    delayMs: clampInt(
      record["delayMs"],
      DEFAULT_COMBAT_PROFILE_DELAY_MS,
      0,
      MAX_DELAY_MS,
    ),
    cooldownMode: normalizeCooldownMode(record["cooldownMode"]),
    ...(fromOption(decodeBoolean, record["resetSkillIndexOnMonsterDeath"])
      ? { resetSkillIndexOnMonsterDeath: true }
      : {}),
    steps: steps.length === 0 ? cloneGenericSteps() : steps,
    ...(messageTriggers.length === 0 ? {} : { messageTriggers }),
  };
};

const normalizeProfiles = (value: unknown): readonly CombatProfile[] => {
  const reservedIds = new Set<string>();
  const profiles = [
    ...normalizeArray(value, (profile) =>
      normalizeProfile(profile, reservedIds),
    ),
  ];

  if (!profiles.some((profile) => profile.id === DEFAULT_COMBAT_PROFILE_ID)) {
    profiles.unshift(genericProfile());
  }

  profiles.sort((left, right) =>
    left.id === DEFAULT_COMBAT_PROFILE_ID
      ? -1
      : right.id === DEFAULT_COMBAT_PROFILE_ID
        ? 1
        : 0,
  );
  return profiles;
};

export const DEFAULT_COMBAT_PROFILE_LIBRARY: CombatProfileLibrary = {
  version: COMBAT_PROFILE_LIBRARY_VERSION,
  profiles: [genericProfile()],
};

export const cloneCombatProfileLibrary = (
  library: CombatProfileLibrary,
): CombatProfileLibrary => structuredClone(library) as CombatProfileLibrary;

export const normalizeCombatProfile = (value: unknown): CombatProfile =>
  normalizeProfile(value, new Set()) ?? genericProfile();

export const isCombatProfileDefinition = (
  value: unknown,
): value is CombatProfileDefinition =>
  Option.isSome(decodeCombatProfileDefinitionInput(value));

export const normalizeCombatProfileLibrary = (
  value: unknown,
): CombatProfileLibrary => ({
  version: COMBAT_PROFILE_LIBRARY_VERSION,
  profiles: normalizeProfiles(asRecord(value)?.["profiles"]),
});

export const findCombatProfileById = (
  library: CombatProfileLibrary,
  profileId: string,
): CombatProfile | undefined =>
  library.profiles.find((profile) => profile.id === profileId);

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
