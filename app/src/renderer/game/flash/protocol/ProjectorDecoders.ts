import type { AuraKind, MonsterData, PlayerData } from "@lucent/game";

import type { FlashPacket } from "../Types";
import {
  asArray,
  asBoolean,
  asEntityState,
  asInt,
  asNumber,
  asPositiveInt,
  asRecord,
  asString,
} from "../payload";

export type AuraTargetType = "monster" | "player";
export type CombatEntityType = "m" | "p";

export interface CombatEntityRef {
  readonly id: number;
  readonly type: CombatEntityType;
}

export interface AuraTargetRef {
  readonly targetId: number;
  readonly targetType: AuraTargetType;
}

export interface DecodedLocationPatch {
  readonly cell?: string;
  readonly pad?: string;
  readonly x?: number;
  readonly y?: number;
}

export interface DecodedPlayerUpdate {
  readonly afk?: boolean;
  readonly location?: DecodedLocationPatch;
  readonly patch: Partial<PlayerData>;
  readonly username: string;
}

export interface DecodedMonsterUpdate {
  readonly monsterMapId: number;
  readonly patch: Partial<MonsterData>;
}

export interface DecodedAuraData {
  readonly category?: string;
  readonly duration: number;
  readonly icon?: string;
  readonly isNew: boolean;
  readonly kind: AuraKind;
  readonly messageOff?: string;
  readonly messageOn?: string;
  readonly name: string;
  readonly value?: number;
}

export interface DecodedAuraAdd {
  readonly auras: readonly DecodedAuraData[];
  readonly command: "aura+" | "aura++" | "aura+p";
  readonly operation: "add";
  readonly source: CombatEntityRef | undefined;
  readonly targets: readonly AuraTargetRef[];
}

export interface DecodedAuraRemoveData {
  readonly messageOff?: string;
  readonly name: string;
}

export interface DecodedAuraRemove {
  readonly auras: readonly DecodedAuraRemoveData[];
  readonly command: "aura-" | "aura--";
  readonly operation: "remove";
  readonly source: CombatEntityRef | undefined;
  readonly targets: readonly AuraTargetRef[];
}

export type DecodedAuraChange = DecodedAuraAdd | DecodedAuraRemove;

export interface DecodedAnimation {
  readonly message: string;
  readonly sourceMonsterMapId?: number;
  readonly targetMonsterMapId?: number;
}

export interface DecodedCombatPacket {
  readonly animations: readonly DecodedAnimation[];
  readonly auraChanges: readonly DecodedAuraChange[];
  readonly command: "cb" | "ct";
  readonly monsterUpdates: readonly DecodedMonsterUpdate[];
  readonly payload: Record<string, unknown>;
  readonly playerUpdates: readonly DecodedPlayerUpdate[];
}

export const packetData = (packet: FlashPacket): unknown =>
  packet.direction === "client" ? packet.params : packet.data;

const isCombatEntityType = (value: string): value is CombatEntityType =>
  value === "m" || value === "p";

export const parseCombatEntityRefs = (
  entityInfo: unknown,
): readonly CombatEntityRef[] => {
  const info = asString(entityInfo);
  if (info === undefined) {
    return [];
  }

  return info.split(",").flatMap((rawToken): readonly CombatEntityRef[] => {
    const trimmed = rawToken.trim();
    const token = trimmed.includes(">")
      ? trimmed.slice(trimmed.lastIndexOf(">") + 1)
      : trimmed;
    const [rawType, rawId] = token.split(":");
    const id = asPositiveInt(rawId);
    if (
      rawType === undefined ||
      id === undefined ||
      !isCombatEntityType(rawType)
    ) {
      return [];
    }

    return [{ id, type: rawType }];
  });
};

export const parseAuraTargets = (
  targetInfo: unknown,
): readonly AuraTargetRef[] =>
  parseCombatEntityRefs(targetInfo).map((ref) => ({
    targetId: ref.id,
    targetType: ref.type === "m" ? "monster" : "player",
  }));

export const parseMonsterMapIdFromEntityInfo = (
  entityInfo: unknown,
): number | undefined =>
  parseCombatEntityRefs(entityInfo).find((ref) => ref.type === "m")?.id;

export const normalizeUpdateMessage = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  const parts = asArray(value)
    .map((part) => asString(part)?.trim())
    .filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? undefined : parts.join("...  ");
};

const normalizeAuraMessage = (value: unknown): string | undefined => {
  const message = asString(value)?.trim();
  return message === "" ? undefined : message;
};

const decodeLocationPatch = (
  update: Record<string, unknown>,
): DecodedLocationPatch | undefined => {
  const cell = asString(update["strFrame"]);
  const pad = asString(update["strPad"]);
  const x = asNumber(update["tx"]);
  const y = asNumber(update["ty"]);

  if (
    cell === undefined &&
    pad === undefined &&
    x === undefined &&
    y === undefined
  ) {
    return undefined;
  }

  return {
    ...(cell === undefined ? {} : { cell }),
    ...(pad === undefined ? {} : { pad }),
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
  };
};

export const decodePlayerUpdate = (
  username: string,
  value: unknown,
): DecodedPlayerUpdate | null => {
  const update = asRecord(value);
  if (update === null) {
    return null;
  }

  const afk = asBoolean(update["afk"]);
  const location = decodeLocationPatch(update);
  const entityId = asPositiveInt(update["entID"]);
  const hp = asInt(update["intHP"]);
  const level = asInt(update["intLevel"]);
  const maxHp = asInt(update["intHPMax"]);
  const mp = asInt(update["intMP"]);
  const maxMp = asInt(update["intMPMax"]);
  const state = asEntityState(update["intState"]);

  return {
    ...(afk === undefined ? {} : { afk }),
    ...(location === undefined ? {} : { location }),
    patch: {
      ...(afk === undefined ? {} : { afk }),
      ...(location?.cell === undefined ? {} : { cell: location.cell }),
      ...(entityId === undefined ? {} : { entityId }),
      ...(hp === undefined ? {} : { hp }),
      ...(level === undefined ? {} : { level }),
      ...(maxHp === undefined ? {} : { maxHp }),
      ...(maxMp === undefined ? {} : { maxMp }),
      ...(mp === undefined ? {} : { mp }),
      ...(location?.pad === undefined ? {} : { pad: location.pad }),
      ...(state === undefined ? {} : { state }),
    },
    username,
  };
};

export const decodeMonsterUpdate = (
  monsterMapIdValue: unknown,
  value: unknown,
): DecodedMonsterUpdate | null => {
  const monsterMapId = asPositiveInt(monsterMapIdValue);
  const update = asRecord(value);
  if (monsterMapId === undefined || update === null) {
    return null;
  }

  const hp = asInt(update["intHP"]);
  const maxHp = asInt(update["intHPMax"]);
  const mp = asInt(update["intMP"]);
  const maxMp = asInt(update["intMPMax"]);
  const state = asEntityState(update["intState"]);
  const cell = asString(update["strFrame"]);

  return {
    monsterMapId,
    patch: {
      ...(cell === undefined ? {} : { cell }),
      ...(hp === undefined ? {} : { hp }),
      ...(maxHp === undefined ? {} : { maxHp }),
      ...(maxMp === undefined ? {} : { maxMp }),
      ...(mp === undefined ? {} : { mp }),
      ...(state === undefined ? {} : { state }),
    },
  };
};

const decodeAuraData = (
  value: unknown,
  kind: AuraKind,
): DecodedAuraData | null => {
  const raw = asRecord(value);
  const name = asString(raw?.["nam"])?.trim();
  if (raw === null || name === undefined || name === "") {
    return null;
  }

  const category = asString(raw["cat"]);
  const icon = asString(raw["icon"]);
  const valueNumber = asNumber(raw["val"]);
  const messageOn = normalizeAuraMessage(raw["msgOn"]);
  const messageOff = normalizeAuraMessage(raw["msgOff"]);

  return {
    ...(category === undefined ? {} : { category }),
    duration: asNumber(raw["dur"]) ?? 0,
    ...(icon === undefined ? {} : { icon }),
    isNew: asBoolean(raw["isNew"]) === true,
    kind,
    ...(messageOff === undefined ? {} : { messageOff }),
    ...(messageOn === undefined ? {} : { messageOn }),
    name,
    ...(valueNumber === undefined ? {} : { value: valueNumber }),
  };
};

const decodeAuraRemoveData = (value: unknown): DecodedAuraRemoveData | null => {
  const raw = asRecord(value);
  const name = asString(raw?.["nam"])?.trim();
  if (raw === null || name === undefined || name === "") {
    return null;
  }

  const messageOff = normalizeAuraMessage(raw["msgOff"]);
  return {
    ...(messageOff === undefined ? {} : { messageOff }),
    name,
  };
};

const auraAddCommands = new Set(["aura+", "aura++", "aura+p"]);
const auraRemoveCommands = new Set(["aura-", "aura--"]);

const decodeAuraChange = (value: unknown): DecodedAuraChange | null => {
  const raw = asRecord(value);
  const command = asString(raw?.["cmd"]);
  const targets = parseAuraTargets(raw?.["tInf"]);
  if (raw === null || command === undefined || targets.length === 0) {
    return null;
  }

  const source = parseCombatEntityRefs(raw["cInf"])[0];
  if (auraAddCommands.has(command)) {
    const addCommand = command as DecodedAuraAdd["command"];
    const kind: AuraKind = addCommand === "aura+p" ? "passive" : "active";
    const auras = asArray(raw["auras"])
      .map((aura) => decodeAuraData(aura, kind))
      .filter((aura): aura is DecodedAuraData => aura !== null);
    return {
      auras,
      command: addCommand,
      operation: "add",
      source,
      targets,
    };
  }

  if (auraRemoveCommands.has(command)) {
    const rawAuras =
      asArray(raw["auras"]).length > 0 ? asArray(raw["auras"]) : [raw["aura"]];
    const auras = rawAuras
      .map(decodeAuraRemoveData)
      .filter((aura): aura is DecodedAuraRemoveData => aura !== null);
    return {
      auras,
      command: command as DecodedAuraRemove["command"],
      operation: "remove",
      source,
      targets,
    };
  }

  return null;
};

const decodeAnimation = (value: unknown): DecodedAnimation | null => {
  const raw = asRecord(value);
  const message = normalizeUpdateMessage(raw?.["msg"]);
  if (raw === null || message === undefined) {
    return null;
  }

  const sourceMonsterMapId = parseMonsterMapIdFromEntityInfo(raw["cInf"]);
  const targetMonsterMapId = parseMonsterMapIdFromEntityInfo(raw["tInf"]);
  if (sourceMonsterMapId === undefined && targetMonsterMapId === undefined) {
    return null;
  }

  return {
    message,
    ...(sourceMonsterMapId === undefined ? {} : { sourceMonsterMapId }),
    ...(targetMonsterMapId === undefined ? {} : { targetMonsterMapId }),
  };
};

export const decodeCombatPacket = (
  packet: FlashPacket,
): DecodedCombatPacket | null => {
  if (packet.command !== "ct" && packet.command !== "cb") {
    return null;
  }

  const payload = asRecord(packetData(packet));
  if (payload === null) {
    return null;
  }

  const playerUpdates = Object.entries(asRecord(payload["p"]) ?? {}).flatMap(
    ([username, value]) => {
      const decoded = decodePlayerUpdate(username, value);
      return decoded === null ? [] : [decoded];
    },
  );
  const monsterUpdates = Object.entries(asRecord(payload["m"]) ?? {}).flatMap(
    ([monsterMapId, value]) => {
      const decoded = decodeMonsterUpdate(monsterMapId, value);
      return decoded === null ? [] : [decoded];
    },
  );
  const auraChanges = asArray(payload["a"])
    .map(decodeAuraChange)
    .filter((change): change is DecodedAuraChange => change !== null);
  const animations = asArray(payload["anims"])
    .map(decodeAnimation)
    .filter((animation): animation is DecodedAnimation => animation !== null);

  return {
    animations,
    auraChanges,
    command: packet.command,
    monsterUpdates,
    payload,
    playerUpdates,
  };
};

const parseCsvPayload = (data: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const token of data.split(",")) {
    const separator = token.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    result[token.slice(0, separator)] = token.slice(separator + 1);
  }
  return result;
};

export const decodeStringPlayerUpdate = (
  packet: FlashPacket,
): DecodedPlayerUpdate | null => {
  const parts = packetData(packet);
  if (!Array.isArray(parts)) {
    return null;
  }

  const username = asString(parts[2]);
  const data = asString(parts[3]);
  if (username === undefined || data === undefined) {
    return null;
  }

  const parsed = parseCsvPayload(data);
  const normalized: Record<string, unknown> = {};
  if (parsed["afk"] !== undefined) normalized["afk"] = parsed["afk"];
  for (const field of [
    "entID",
    "intHP",
    "intHPMax",
    "intLevel",
    "intMP",
    "intMPMax",
    "intState",
  ] as const) {
    if (parsed[field] !== undefined) normalized[field] = parsed[field];
  }
  if (parsed["strFrame"] !== undefined)
    normalized["strFrame"] = parsed["strFrame"];
  if (parsed["strPad"] !== undefined) normalized["strPad"] = parsed["strPad"];

  // Cross-cell updates report px/py beside destination tx/ty; px/py is authoritative.
  const movingFromPosition =
    parsed["px"] !== undefined || parsed["py"] !== undefined;
  if (movingFromPosition) {
    if (parsed["px"] !== undefined) normalized["tx"] = parsed["px"];
    if (parsed["py"] !== undefined) normalized["ty"] = parsed["py"];
  } else {
    if (parsed["tx"] !== undefined) normalized["tx"] = parsed["tx"];
    if (parsed["ty"] !== undefined) normalized["ty"] = parsed["ty"];
  }

  return decodePlayerUpdate(username, normalized);
};

export const decodeStringMonsterUpdate = (
  packet: FlashPacket,
): DecodedMonsterUpdate | null => {
  const parts = packetData(packet);
  if (!Array.isArray(parts)) {
    return null;
  }

  const data = asString(parts[3]);
  return data === undefined
    ? null
    : decodeMonsterUpdate(parts[2], parseCsvPayload(data));
};

export const decodeRespawnMonsterIds = (
  packet: FlashPacket,
): readonly number[] => {
  const parts = packetData(packet);
  const ids = Array.isArray(parts) ? asString(parts[2]) : undefined;
  if (ids === undefined) {
    return [];
  }

  return ids
    .split(",")
    .map((id) => asPositiveInt(id))
    .filter((id): id is number => id !== undefined);
};
