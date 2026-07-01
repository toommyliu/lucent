import { Option } from "effect";

import type {
  AuraRecord,
  ItemRecord,
  MonsterRecord,
  PlayerRecord,
  QuestRecord,
  ServerRecord,
  ShopInfoRecord,
  ShopItemRecord,
  UnknownRecord,
} from "./Types";

export const asRecord = (value: unknown): UnknownRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

export const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

export const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

export const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const asInt = (value: unknown): number | undefined => {
  const number = asNumber(value);
  return number === undefined ? undefined : Math.trunc(number);
};

export const asPositiveInt = (value: unknown): number | undefined => {
  const number = asInt(value);
  return number !== undefined && number > 0 ? number : undefined;
};

export const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  return undefined;
};

export const equalsIgnoreCase = (left: string, right: string): boolean =>
  left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

export const includesIgnoreCase = (value: string, search: string): boolean =>
  value.toLowerCase().includes(search.toLowerCase());

export const optionFromNullable = <A>(value: A | null | undefined) =>
  value === null || value === undefined ? Option.none<A>() : Option.some(value);

const houseItemTypes = new Set(["House", "Floor Item", "Wall Item"]);

export const normalizeItemRecord = (
  value: unknown,
  defaults?: Partial<ItemRecord>,
): ItemRecord | null => {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const itemId = asPositiveInt(record["ItemID"] ?? record["itemId"]);
  if (itemId === undefined) {
    return null;
  }

  const category = asString(record["sType"] ?? record["category"]) ?? "";
  const house =
    asBoolean(record["bHouse"]) === true ||
    defaults?.house === true ||
    houseItemTypes.has(category);
  const temp =
    (asNumber(record["bTemp"]) ?? 0) !== 0 || defaults?.temp === true;
  const banked =
    asBoolean(record["bBank"]) === true || defaults?.banked === true;

  const charItemId =
    asPositiveInt(record["CharItemID"]) ?? defaults?.charItemId;
  const enhancementDps = asNumber(record["EnhDPS"]);
  const enhancementId = asPositiveInt(record["EnhID"] ?? record["iEnh"]);
  const enhancementLevel = asPositiveInt(record["EnhLvl"]);
  const enhancementPatternId = asPositiveInt(
    record["EnhPatternID"] ?? record["EnhPID"],
  );
  const enhancementRange = asNumber(record["EnhRng"]);
  const enhancementRarity = asNumber(record["EnhRty"]);
  const hasEnhancement =
    enhancementDps !== undefined ||
    enhancementId !== undefined ||
    enhancementLevel !== undefined ||
    enhancementPatternId !== undefined ||
    enhancementRange !== undefined ||
    enhancementRarity !== undefined;

  return {
    banked,
    category,
    ...(charItemId === undefined ? {} : { charItemId }),
    coins: asBoolean(record["bCoins"]) === true || defaults?.coins === true,
    cost: asNumber(record["iCost"]) ?? defaults?.cost ?? 0,
    description:
      asString(record["sDesc"] ?? record["description"]) ??
      defaults?.description ??
      "",
    ...(hasEnhancement
      ? {
          enhancement: {
            ...(enhancementDps === undefined ? {} : { dps: enhancementDps }),
            ...(enhancementId === undefined ? {} : { id: enhancementId }),
            ...(enhancementLevel === undefined
              ? {}
              : { level: enhancementLevel }),
            ...(enhancementPatternId === undefined
              ? {}
              : { patternId: enhancementPatternId }),
            ...(enhancementRange === undefined
              ? {}
              : { range: enhancementRange }),
            ...(enhancementRarity === undefined
              ? {}
              : { rarity: enhancementRarity }),
          },
        }
      : {}),
    equipped:
      asBoolean(record["bEquip"]) === true || defaults?.equipped === true,
    equipmentSlot:
      asString(record["sES"] ?? record["strES"] ?? record["equipmentSlot"]) ??
      defaults?.equipmentSlot ??
      "",
    file: asString(record["sFile"]) ?? defaults?.file ?? "",
    house,
    itemId,
    link: asString(record["sLink"]) ?? defaults?.link ?? "",
    meta: asString(record["sMeta"]) ?? defaults?.meta ?? "",
    name:
      asString(record["sName"] ?? record["name"]) ??
      defaults?.name ??
      `Item ${itemId}`,
    quantity: Math.max(
      0,
      asInt(record["iQty"] ?? record["quantity"]) ?? defaults?.quantity ?? 1,
    ),
    temp,
    virtual:
      asBoolean(record["virtual"]) === true || defaults?.virtual === true,
  };
};

export const normalizeShopItemRecord = (
  value: unknown,
): ShopItemRecord | null => {
  const item = normalizeItemRecord(value);
  if (item === null) {
    return null;
  }

  const record = asRecord(value);
  const shopItemId =
    asString(record?.["ShopItemID"]) ?? asPositiveInt(record?.["ShopItemID"]);

  return {
    ...item,
    ...(shopItemId === undefined ? {} : { shopItemId }),
  };
};

export const normalizeShopInfoRecord = (
  value: unknown,
): ShopInfoRecord | null => {
  const record = asRecord(value);
  const shopinfo = asRecord(record?.["shopinfo"]) ?? record;
  if (shopinfo === null) {
    return null;
  }

  const id = asPositiveInt(shopinfo["ShopID"]);
  if (id === undefined) {
    return null;
  }

  const items = asArray(shopinfo["items"])
    .map(normalizeShopItemRecord)
    .filter((item): item is ShopItemRecord => item !== null);

  return {
    house: asBoolean(shopinfo["bHouse"]) === true,
    id,
    items,
    limited: asBoolean(shopinfo["bLimited"]) === true,
    merge:
      asBoolean(shopinfo["bMerge"]) === true ||
      asString(shopinfo["sType"]) === "Merge",
    name: asString(shopinfo["sName"] ?? shopinfo["Name"]) ?? `Shop ${id}`,
  };
};

export const normalizeQuestRecord = (
  idValue: unknown,
  value: unknown,
): QuestRecord | null => {
  const id = asPositiveInt(idValue);
  const raw = asRecord(value);
  if (id === undefined || raw === null) {
    return null;
  }

  return {
    id,
    name: asString(raw["sName"] ?? raw["name"]) ?? `Quest ${id}`,
    raw,
  };
};

export const normalizeServerRecord = (value: unknown): ServerRecord | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const name = asString(raw["sName"]);
  if (name === undefined || name.trim() === "") {
    return null;
  }

  return {
    chat: asInt(raw["iChat"]) ?? 0,
    count: asInt(raw["iCount"]) ?? 0,
    language: asString(raw["sLang"]) ?? "",
    max: asInt(raw["iMax"]) ?? 0,
    memberOnly: asBoolean(raw["bUpg"]) === true,
    name,
    online: asBoolean(raw["bOnline"]) !== false,
    raw,
  };
};

export const normalizeAuraRecord = (value: unknown): AuraRecord | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const name = asString(raw["nam"] ?? raw["name"]);
  if (name === undefined || name.trim() === "") {
    return null;
  }

  const category = asString(raw["cat"]);
  const icon = asString(raw["icon"]);
  const auraValue = asNumber(raw["val"] ?? raw["value"]);

  return {
    ...(category === undefined ? {} : { category }),
    duration: asNumber(raw["dur"] ?? raw["duration"]) ?? 0,
    ...(icon === undefined ? {} : { icon }),
    name,
    stack: asPositiveInt(raw["stack"]) ?? 1,
    ...(auraValue === undefined ? {} : { value: auraValue }),
  };
};

export const normalizePlayerRecord = (value: unknown): PlayerRecord | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const entityId = asPositiveInt(raw["entID"] ?? raw["entityId"]);
  const username = asString(raw["strUsername"] ?? raw["username"]);
  if (entityId === undefined || username === undefined) {
    return null;
  }

  return {
    afk: asBoolean(raw["afk"]) === true,
    cell: asString(raw["strFrame"] ?? raw["cell"]) ?? "",
    entityId,
    entityType: asString(raw["entType"] ?? raw["entityType"]) ?? "player",
    hp: asInt(raw["intHP"] ?? raw["hp"]) ?? 0,
    level: asInt(raw["intLevel"] ?? raw["level"]) ?? 0,
    maxHp: asInt(raw["intHPMax"] ?? raw["maxHp"]) ?? 0,
    maxMp: asInt(raw["intMPMax"] ?? raw["maxMp"]) ?? 0,
    mp: asInt(raw["intMP"] ?? raw["mp"]) ?? 0,
    name: asString(raw["uoName"] ?? raw["name"]) ?? username,
    pad: asString(raw["strPad"] ?? raw["pad"]) ?? "",
    position: [asNumber(raw["tx"]) ?? 0, asNumber(raw["ty"]) ?? 0],
    state: asInt(raw["intState"] ?? raw["state"]) ?? 0,
    username,
  };
};

export const normalizeMonsterRecord = (
  value: unknown,
  defaults?: Partial<MonsterRecord>,
): MonsterRecord | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const monsterMapId = asPositiveInt(
    raw["MonMapID"] ?? raw["monMapId"] ?? defaults?.monsterMapId,
  );
  if (monsterMapId === undefined) {
    return null;
  }

  return {
    cell: asString(raw["strFrame"] ?? raw["cell"]) ?? defaults?.cell ?? "",
    hp: asInt(raw["intHP"] ?? raw["hp"]) ?? defaults?.hp ?? 0,
    level: asInt(raw["iLvl"] ?? raw["level"]) ?? defaults?.level ?? 0,
    maxHp: asInt(raw["intHPMax"] ?? raw["maxHp"]) ?? defaults?.maxHp ?? 0,
    maxMp: asInt(raw["intMPMax"] ?? raw["maxMp"]) ?? defaults?.maxMp ?? 0,
    monsterId:
      asPositiveInt(raw["MonID"] ?? raw["monsterId"]) ??
      defaults?.monsterId ??
      0,
    monsterMapId,
    mp: asInt(raw["intMP"] ?? raw["mp"]) ?? defaults?.mp ?? 0,
    name:
      asString(raw["strMonName"] ?? raw["name"]) ??
      defaults?.name ??
      `Monster ${monsterMapId}`,
    race: asString(raw["sRace"] ?? raw["race"]) ?? defaults?.race ?? "",
    state: asInt(raw["intState"] ?? raw["state"]) ?? defaults?.state ?? 0,
  };
};
