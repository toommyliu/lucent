import { Schema } from "effect";

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
  readonly playerName: string;
  readonly sessionId: string;
}

export interface ArmySyncPayload {
  readonly label?: string;
  readonly playerName: string;
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
  readonly playerName: string;
  readonly reason: string;
  readonly sessionId: string;
  readonly step?: number;
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

const equipSetFieldNames = [
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

const equipSetFields = new Set<string>(equipSetFieldNames);

export const normalizeArmyConfigName = (fileName: string): string => {
  let normalized = fileName.trim();
  if (normalized.toLowerCase().endsWith(".yaml")) {
    normalized = normalized.slice(0, -".yaml".length);
  }

  return normalized.trim();
};

export const isValidArmyConfigName = (configName: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(configName);

export const assertValidArmyConfigName = (fileName: string): string => {
  const configName = normalizeArmyConfigName(fileName);
  if (configName === "") {
    throw new Error("Army config name is required");
  }

  if (!isValidArmyConfigName(configName)) {
    throw new Error(
      "Army config name may only contain letters, numbers, dots, dashes, and underscores",
    );
  }

  return configName;
};

const isRecord = (value: unknown): value is ArmyConfigRaw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized === "" ? undefined : normalized;
};

const parsePlayers = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new Error("Army config players must be a non-empty array");
  }

  const players = value.map(readString);
  if (players.length === 0 || players.some((player) => player === undefined)) {
    throw new Error("Army config players must only contain non-empty strings");
  }

  return players as readonly string[];
};

const assertUniquePlayers = (players: readonly string[]): void => {
  const seen = new Set<string>();
  for (const player of players) {
    const key = normalizeArmyPlayerKey(player);
    if (seen.has(key)) {
      throw new Error(`Duplicate army player: ${player}`);
    }

    seen.add(key);
  }
};

const parseItems = (value: unknown): Readonly<Record<string, string>> => {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("Army config items must be an object");
  }

  const items: Record<string, string> = {};
  for (const [key, rawItem] of Object.entries(value)) {
    const itemKey = key.trim();
    const item = readString(rawItem);
    if (itemKey === "" || item === undefined) {
      throw new Error("Army config items must map non-empty aliases to items");
    }

    items[itemKey] = item;
  }

  return items;
};

const readOptionalEquipString = (
  value: unknown,
  path: string,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = readString(value);
  if (normalized === undefined) {
    throw new Error(`${path} must be a non-empty string`);
  }

  return normalized;
};

const parsePots = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of non-empty strings`);
  }

  const pots = value.map(readString);
  if (pots.some((pot) => pot === undefined)) {
    throw new Error(`${path} must be an array of non-empty strings`);
  }

  return pots as readonly string[];
};

const parseEquipSet = (value: unknown, path: string): ArmyEquipSet => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const set: Record<string, string | readonly string[]> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!equipSetFields.has(key)) {
      throw new Error(`Unknown army equip set key: ${path}.${key}`);
    }

    if (key === "pots") {
      set[key] = parsePots(rawValue, `${path}.${key}`);
      continue;
    }

    const normalized = readOptionalEquipString(rawValue, `${path}.${key}`);
    if (normalized !== undefined) {
      set[key] = normalized;
    }
  }

  return set as unknown as ArmyEquipSet;
};

const parseSets = (
  value: unknown,
  playerCount: number,
): Readonly<Record<string, ArmySetConfig>> => {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("Army config sets must be an object");
  }

  const sets: Record<string, ArmySetConfig> = {};
  for (const [setName, rawSet] of Object.entries(value)) {
    const normalizedSetName = setName.trim();
    if (normalizedSetName === "") {
      throw new Error("Army config set names must be non-empty");
    }

    if (!isRecord(rawSet)) {
      throw new Error(`Army config set ${normalizedSetName} must be an object`);
    }

    const players: Record<string, ArmyEquipSet> = {};
    let defaultSet: ArmyEquipSet | undefined;

    for (const [key, rawValue] of Object.entries(rawSet)) {
      if (key === "default") {
        defaultSet = parseEquipSet(
          rawValue,
          `sets.${normalizedSetName}.default`,
        );
        continue;
      }

      const playerMatch = key.match(/^player([1-9]\d*)$/);
      if (playerMatch?.[1] === undefined) {
        throw new Error(
          `Unknown army set slot: sets.${normalizedSetName}.${key}`,
        );
      }

      const playerNumber = Number.parseInt(playerMatch[1], 10);
      if (playerNumber > playerCount) {
        throw new Error(
          `Army set slot ${key} is outside the configured player roster`,
        );
      }

      players[key] = parseEquipSet(
        rawValue,
        `sets.${normalizedSetName}.${key}`,
      );
    }

    sets[normalizedSetName] = {
      ...(defaultSet === undefined ? {} : { default: defaultSet }),
      players,
    };
  }

  return sets;
};

export const normalizeArmyPlayerKey = (playerName: string): string =>
  playerName.trim().toLowerCase();

export const assertArmyConfigRaw = (value: unknown): ArmyConfigRaw => {
  if (!isRecord(value)) {
    throw new Error("Army config must be a YAML object");
  }

  return value;
};

export const parseArmyConfigCore = (value: unknown): ArmyConfigCore => {
  const raw = assertArmyConfigRaw(value);
  const players = parsePlayers(raw["players"]);
  assertUniquePlayers(players);

  const room = readString(raw["room"]);
  if (room === undefined) {
    throw new Error("Army config must define room");
  }

  return {
    items: parseItems(raw["items"]),
    players,
    room,
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
  if (set === undefined) {
    return undefined;
  }

  return {
    ...set.default,
    ...set.players[`player${session.playerNumber}`],
  };
};

export const resolveArmyItemAlias = (
  config: Pick<ArmyConfigPayload, "items">,
  item: string | undefined,
): string | undefined => {
  const normalized = readString(item);
  if (normalized === undefined) {
    return undefined;
  }

  return config.items[normalized] ?? normalized;
};
