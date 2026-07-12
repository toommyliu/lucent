import { Option, Schema } from "effect";

export type ArmyConfigRaw = Record<string, unknown>;

export interface ArmyEquipSet {
  readonly armor?: string;
  readonly cape?: string;
  readonly class?: string;
  readonly helm?: string;
  readonly pet?: string;
  readonly pots?: readonly string[];
  readonly safeClass?: string;
  readonly safePot?: string;
  readonly scroll?: string;
  readonly weapon?: string;
}

export interface ArmySetConfig {
  readonly default?: ArmyEquipSet;
  readonly players: Readonly<Record<string, ArmyEquipSet>>;
}

export interface ArmyConfigCore {
  readonly items: Readonly<Record<string, string>>;
  readonly players: readonly string[];
  readonly room: string;
  readonly sets: Readonly<Record<string, ArmySetConfig>>;
}

export interface ArmyConfigPayload extends ArmyConfigCore {
  readonly configName: string;
  readonly raw: ArmyConfigRaw;
}

export interface ArmySessionPayload extends ArmyConfigPayload {
  readonly playerName: string;
  readonly playerNumber: number;
  readonly role: "leader" | "member";
  readonly sessionId: string;
}

export interface ArmyStartPayload {
  readonly configName: string;
  readonly playerName: string;
}

export interface ArmyLeavePayload {
  readonly sessionId: string;
}

export interface ArmySyncPayload {
  readonly label?: string;
  readonly sessionId: string;
  readonly step: number;
  readonly timeoutMs?: number;
}

export interface ArmyProgressPayload extends ArmySyncPayload {
  readonly complete: boolean;
}

export interface ArmyProgressResult {
  readonly complete: boolean;
  readonly completedPlayers: readonly string[];
  readonly pendingPlayers: readonly string[];
}

export interface ArmyFailPayload {
  readonly label?: string;
  readonly reason: string;
  readonly sessionId: string;
  readonly step?: number;
}

export interface ArmySessionEndedPayload {
  readonly reason: string;
  readonly sessionId: string;
}

export const ArmyConfigRawSchema = Schema.Record(Schema.String, Schema.Unknown);

export const ArmyEquipSetSchema = Schema.Struct({
  armor: Schema.optionalKey(Schema.String),
  cape: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
  helm: Schema.optionalKey(Schema.String),
  pet: Schema.optionalKey(Schema.String),
  pots: Schema.optionalKey(Schema.Array(Schema.String)),
  safeClass: Schema.optionalKey(Schema.String),
  safePot: Schema.optionalKey(Schema.String),
  scroll: Schema.optionalKey(Schema.String),
  weapon: Schema.optionalKey(Schema.String),
});

export const ArmySetConfigSchema = Schema.Struct({
  default: Schema.optionalKey(ArmyEquipSetSchema),
  players: Schema.Record(Schema.String, ArmyEquipSetSchema),
});

const ArmyConfigPayloadFields = {
  configName: Schema.String,
  items: Schema.Record(Schema.String, Schema.String),
  players: Schema.Array(Schema.String),
  raw: ArmyConfigRawSchema,
  room: Schema.String,
  sets: Schema.Record(Schema.String, ArmySetConfigSchema),
} as const;

export const ArmyConfigPayloadSchema = Schema.Struct(ArmyConfigPayloadFields);

export const ArmySessionPayloadSchema = Schema.Struct({
  ...ArmyConfigPayloadFields,
  playerName: Schema.String,
  playerNumber: Schema.Int,
  role: Schema.Literals(["leader", "member"]),
  sessionId: Schema.String,
});

export const ArmySessionEndedPayloadSchema = Schema.Struct({
  reason: Schema.String,
  sessionId: Schema.String,
});

const EquipFieldNames = [
  "armor",
  "cape",
  "class",
  "helm",
  "pet",
  "pots",
  "safeClass",
  "safePot",
  "scroll",
  "weapon",
] as const;

const EquipFields = new Set<string>(EquipFieldNames);
const decodeRecord = Schema.decodeUnknownOption(ArmyConfigRawSchema);
const decodeArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeStringLike = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Number]),
);

const recordAt = (value: unknown, message: string): ArmyConfigRaw => {
  const decoded = decodeRecord(value);
  if (Option.isNone(decoded)) throw new Error(message);
  return decoded.value;
};

const stringAt = (value: unknown, message: string): string => {
  const decoded = decodeStringLike(value);
  if (Option.isNone(decoded)) throw new Error(message);
  const normalized = String(decoded.value).trim();
  if (normalized === "") throw new Error(message);
  return normalized;
};

const optionalStringAt = (
  value: unknown,
  message: string,
): string | undefined =>
  value === undefined ? undefined : stringAt(value, message);

const arrayAt = (value: unknown, message: string): readonly unknown[] => {
  const decoded = decodeArray(value);
  if (Option.isNone(decoded)) throw new Error(message);
  return decoded.value;
};

export const normalizeArmyConfigName = (fileName: string): string => {
  const trimmed = fileName.trim();
  return trimmed.toLowerCase().endsWith(".yaml")
    ? trimmed.slice(0, -5).trim()
    : trimmed;
};

export const isValidArmyConfigName = (configName: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(configName);

export const assertValidArmyConfigName = (fileName: string): string => {
  const configName = normalizeArmyConfigName(fileName);
  if (configName === "") throw new Error("Army config name is required");
  if (!isValidArmyConfigName(configName)) {
    throw new Error(
      "Army config name may only contain letters, numbers, dots, dashes, and underscores",
    );
  }
  return configName;
};

export const normalizeArmyPlayerKey = (playerName: string): string =>
  playerName.trim().toLowerCase();

export const assertArmyConfigRaw = (value: unknown): ArmyConfigRaw =>
  recordAt(value, "Army config must be a YAML object");

const parsePlayers = (value: unknown): readonly string[] => {
  const rawPlayers = arrayAt(
    value,
    "Army config players must be a non-empty array",
  );
  if (rawPlayers.length === 0) {
    throw new Error("Army config players must be a non-empty array");
  }

  const players = rawPlayers.map((player) =>
    stringAt(player, "Army config players must only contain non-empty strings"),
  );
  const seen = new Set<string>();
  for (const player of players) {
    const key = normalizeArmyPlayerKey(player);
    if (seen.has(key)) throw new Error(`Duplicate army player: ${player}`);
    seen.add(key);
  }
  return players;
};

const parseItems = (value: unknown): Readonly<Record<string, string>> => {
  if (value === undefined) return {};
  const raw = recordAt(value, "Army config items must be an object");
  return Object.fromEntries(
    Object.entries(raw).map(([alias, item]) => {
      const normalizedAlias = alias.trim();
      if (normalizedAlias === "") {
        throw new Error(
          "Army config items must map non-empty aliases to items",
        );
      }
      return [
        normalizedAlias,
        stringAt(item, "Army config items must map non-empty aliases to items"),
      ];
    }),
  );
};

const parseEquipSet = (value: unknown, path: string): ArmyEquipSet => {
  const raw = recordAt(value, `${path} must be an object`);
  const parsed: Record<string, string | readonly string[]> = {};
  for (const [field, fieldValue] of Object.entries(raw)) {
    if (!EquipFields.has(field)) {
      throw new Error(`Unknown army equip set key: ${path}.${field}`);
    }
    if (field === "pots") {
      parsed[field] = arrayAt(
        fieldValue,
        `${path}.pots must be an array of non-empty strings`,
      ).map((pot) =>
        stringAt(pot, `${path}.pots must be an array of non-empty strings`),
      );
    } else {
      const item = optionalStringAt(
        fieldValue,
        `${path}.${field} must be a non-empty string`,
      );
      if (item !== undefined) parsed[field] = item;
    }
  }
  return parsed as unknown as ArmyEquipSet;
};

const parseSets = (
  value: unknown,
  playerCount: number,
): Readonly<Record<string, ArmySetConfig>> => {
  if (value === undefined) return {};
  const rawSets = recordAt(value, "Army config sets must be an object");
  const sets: Record<string, ArmySetConfig> = {};

  for (const [rawName, value] of Object.entries(rawSets)) {
    const setName = rawName.trim();
    if (setName === "")
      throw new Error("Army config set names must be non-empty");
    const rawSet = recordAt(
      value,
      `Army config set ${setName} must be an object`,
    );
    const players: Record<string, ArmyEquipSet> = {};
    let defaultSet: ArmyEquipSet | undefined;

    for (const [slot, slotValue] of Object.entries(rawSet)) {
      if (slot === "default") {
        defaultSet = parseEquipSet(slotValue, `sets.${setName}.default`);
        continue;
      }
      const match = /^player([1-9]\d*)$/.exec(slot);
      if (match?.[1] === undefined) {
        throw new Error(`Unknown army set slot: sets.${setName}.${slot}`);
      }
      if (Number.parseInt(match[1], 10) > playerCount) {
        throw new Error(
          `Army set slot ${slot} is outside the configured player roster`,
        );
      }
      players[slot] = parseEquipSet(slotValue, `sets.${setName}.${slot}`);
    }

    sets[setName] = {
      ...(defaultSet === undefined ? {} : { default: defaultSet }),
      players,
    };
  }
  return sets;
};

export const parseArmyConfigCore = (value: unknown): ArmyConfigCore => {
  const raw = assertArmyConfigRaw(value);
  const players = parsePlayers(raw["players"]);
  return {
    items: parseItems(raw["items"]),
    players,
    room: stringAt(raw["room"], "Army config must define room"),
    sets: parseSets(raw["sets"], players.length),
  };
};

export const normalizeArmyConfig = (
  configName: string,
  value: unknown,
): ArmyConfigPayload => {
  const raw = assertArmyConfigRaw(value);
  return {
    configName: assertValidArmyConfigName(configName),
    raw,
    ...parseArmyConfigCore(raw),
  };
};

export const resolveArmyEquipSet = (
  session: Pick<ArmySessionPayload, "playerNumber" | "sets">,
  setName: string,
): ArmyEquipSet | undefined => {
  const set = session.sets[setName];
  if (set === undefined) return undefined;
  return {
    ...set.default,
    ...set.players[`player${session.playerNumber}`],
  };
};

export const resolveArmyItemAlias = (
  config: Pick<ArmyConfigPayload, "items">,
  item: string | undefined,
): string | undefined => {
  if (item === undefined) return undefined;
  const normalized = item.trim();
  return normalized === ""
    ? undefined
    : (config.items[normalized] ?? normalized);
};
