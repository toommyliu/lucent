import { Option } from "effect";

import {
  EntityState,
  isEntityState,
  LiveAura,
  LiveItem,
  LiveMonster,
  LiveOutfit,
  LivePlayer,
  LiveQuest,
  LiveServer,
  LiveShop,
} from "@lucent/game";
import type { AuraKind, ItemData, MonsterData } from "@lucent/game";
import type { UnknownRecord } from "./Types";

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

export const asEntityState = (value: unknown): EntityState | undefined => {
  const state = asInt(value);
  return isEntityState(state) ? state : undefined;
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

export const decodeItem = (
  value: unknown,
  defaults?: Partial<ItemData>,
): LiveItem | null => {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const itemId = asPositiveInt(record["ItemID"]) ?? defaults?.itemId;
  if (itemId === undefined) {
    return null;
  }

  const category = asString(record["sType"]) ?? defaults?.category ?? "";
  const houseItem =
    asBoolean(record["bHouse"]) === true ||
    defaults?.houseItem === true ||
    houseItemTypes.has(category);
  const temporaryItem =
    asBoolean(record["bTemp"]) === true || defaults?.temporaryItem === true;
  const banked =
    asBoolean(record["bBank"]) === true || defaults?.context === "bank";

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

  const context = banked
    ? "bank"
    : (defaults?.context ??
      (temporaryItem ? "temporary" : houseItem ? "house" : "inventory"));

  return new LiveItem({
    category,
    ...(charItemId === undefined ? {} : { charItemId }),
    coins: asBoolean(record["bCoins"]) === true || defaults?.coins === true,
    context,
    cost: asNumber(record["iCost"]) ?? defaults?.cost ?? 0,
    description: asString(record["sDesc"]) ?? defaults?.description ?? "",
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
      asString(record["sES"] ?? record["strES"]) ??
      defaults?.equipmentSlot ??
      "",
    file: asString(record["sFile"]) ?? defaults?.file ?? "",
    houseItem,
    itemId,
    link: asString(record["sLink"]) ?? defaults?.link ?? "",
    meta: asString(record["sMeta"]) ?? defaults?.meta ?? "",
    name: asString(record["sName"]) ?? defaults?.name ?? `Item ${itemId}`,
    quantity: Math.max(0, asInt(record["iQty"]) ?? defaults?.quantity ?? 1),
    temporaryItem,
  });
};

export const decodeShopItem = (value: unknown): LiveItem | null => {
  const item = decodeItem(value, { context: "shop" });
  if (item === null) {
    return null;
  }

  const record = asRecord(value);
  const shopItemId = asPositiveInt(record?.["ShopItemID"]);

  if (shopItemId !== undefined) item.update({ shopItemId });
  return item;
};

const asColor = (value: unknown): number | undefined => {
  const color = asInt(value);
  return color !== undefined && color >= 0 && color <= 0xffffff
    ? color
    : undefined;
};

export const decodeOutfitModel = (value: unknown): LiveOutfit | null => {
  const record = asRecord(value);
  const name = asString(record?.["name"])?.trim();
  if (record === null || name === undefined || name === "") {
    return null;
  }

  const colors = asRecord(record["colors"]);
  return new LiveOutfit({
    colors: {
      accessory: asColor(colors?.["accessory"]),
      base: asColor(colors?.["base"]),
      eye: asColor(colors?.["eye"]),
      hair: asColor(colors?.["hair"]),
      skin: asColor(colors?.["skin"]),
      trim: asColor(colors?.["trim"]),
    },
    equipment: {
      armorItemId: asPositiveInt(record["co"]),
      capeItemId: asPositiveInt(record["ba"]),
      classItemId: asPositiveInt(record["ar"]),
      helmItemId: asPositiveInt(record["he"]),
      itemId: asPositiveInt(record["None"]),
      miscItemId: asPositiveInt(record["mi"]),
      petItemId: asPositiveInt(record["pe"]),
      weaponItemId: asPositiveInt(record["Weapon"]),
    },
    name,
  });
};

export const decodeShop = (value: unknown): LiveShop | null => {
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
    .map(decodeShopItem)
    .filter((item): item is LiveItem => item !== null);

  return new LiveShop({
    house: asBoolean(shopinfo["bHouse"]) === true,
    id,
    items,
    limited: asBoolean(shopinfo["bLimited"]) === true,
    merge:
      asBoolean(shopinfo["bMerge"]) === true ||
      asString(shopinfo["sType"]) === "Merge",
    name: asString(shopinfo["sName"]) ?? `Shop ${id}`,
  });
};

const decodeQuestItems = (
  value: unknown,
): readonly { itemId: number; name: string; quantity: number }[] =>
  asArray(value).flatMap((entry) => {
    const item = asRecord(entry);
    const itemId = asPositiveInt(item?.["ItemID"]);
    if (itemId === undefined) return [];
    return [
      {
        itemId,
        name: asString(item?.["sName"]) ?? `Item ${itemId}`,
        quantity: Math.max(1, asInt(item?.["iQty"]) ?? 1),
      },
    ];
  });

export const decodeQuest = (
  idValue: unknown,
  value: unknown,
): LiveQuest | null => {
  const id = asPositiveInt(idValue);
  const raw = asRecord(value);
  if (id === undefined || raw === null) {
    return null;
  }

  const field = asString(raw["sField"]);
  const rewards = decodeQuestItems(raw["Rewards"] ?? raw["Rewards2"]).map(
    (reward, index) => {
      const source = asRecord(
        asArray(raw["Rewards"] ?? raw["Rewards2"])[index],
      );
      const chance = asNumber(source?.["DropChance"] ?? source?.["iRate"]);
      return chance === undefined
        ? reward
        : Object.assign(reward, { dropChance: chance });
    },
  );

  return new LiveQuest({
    cadence:
      field === "id0"
        ? "daily"
        : field === "iw0"
          ? "weekly"
          : field === "im0"
            ? "monthly"
            : "none",
    id,
    name: asString(raw["sName"]) ?? `Quest ${id}`,
    once: asBoolean(raw["bOnce"]) === true,
    requirements: decodeQuestItems(raw["RequiredItems"]),
    rewards,
  });
};

export const decodeServer = (value: unknown): LiveServer | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const name = asString(raw["sName"]);
  if (name === undefined || name.trim() === "") {
    return null;
  }

  return new LiveServer({
    chat: asInt(raw["iChat"]) ?? 0,
    count: asInt(raw["iCount"]) ?? 0,
    language: asString(raw["sLang"]) ?? "",
    max: asInt(raw["iMax"]) ?? 0,
    memberOnly: asBoolean(raw["bUpg"]) === true,
    name,
    online: asBoolean(raw["bOnline"]) !== false,
  });
};

export const decodeAuraModel = (
  value: unknown,
  kind: AuraKind = "active",
): LiveAura | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const name = asString(raw["nam"]);
  if (name === undefined || name.trim() === "") {
    return null;
  }

  const category = asString(raw["cat"]);
  const icon = asString(raw["icon"]);
  const auraValue = asNumber(raw["val"]);

  return new LiveAura({
    ...(category === undefined ? {} : { category }),
    duration: asNumber(raw["dur"]) ?? 0,
    ...(icon === undefined ? {} : { icon }),
    kind,
    name,
    stack: 1,
    ...(auraValue === undefined ? {} : { value: auraValue }),
  });
};

export const decodePlayerModel = (value: unknown): LivePlayer | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const entityId = asPositiveInt(raw["entID"]);
  const username = asString(raw["strUsername"]);
  if (entityId === undefined || username === undefined) {
    return null;
  }

  return new LivePlayer({
    afk: asBoolean(raw["afk"]) === true,
    cell: asString(raw["strFrame"]) ?? "",
    entityId,
    entityType: asString(raw["entType"]) ?? "player",
    hp: asInt(raw["intHP"]) ?? 0,
    level: asInt(raw["intLevel"]) ?? 0,
    maxHp: asInt(raw["intHPMax"]) ?? 0,
    maxMp: asInt(raw["intMPMax"]) ?? 0,
    mp: asInt(raw["intMP"]) ?? 0,
    name: username,
    pad: asString(raw["strPad"]) ?? "",
    position: { x: asNumber(raw["tx"]) ?? 0, y: asNumber(raw["ty"]) ?? 0 },
    state: asEntityState(raw["intState"]) ?? EntityState.Idle,
    username,
  });
};

export const decodeMonsterModel = (
  value: unknown,
  defaults?: Partial<MonsterData>,
): LiveMonster | null => {
  const raw = asRecord(value);
  if (raw === null) {
    return null;
  }

  const monsterMapId = asPositiveInt(raw["MonMapID"]) ?? defaults?.monsterMapId;
  if (monsterMapId === undefined) {
    return null;
  }

  return new LiveMonster({
    cell: asString(raw["strFrame"]) ?? defaults?.cell ?? "",
    hp: asInt(raw["intHP"]) ?? defaults?.hp ?? 0,
    level: asInt(raw["iLvl"]) ?? defaults?.level ?? 0,
    maxHp: asInt(raw["intHPMax"]) ?? defaults?.maxHp ?? 0,
    maxMp: asInt(raw["intMPMax"]) ?? defaults?.maxMp ?? 0,
    monsterId: asPositiveInt(raw["MonID"]) ?? defaults?.monsterId ?? 0,
    monsterMapId,
    mp: asInt(raw["intMP"]) ?? defaults?.mp ?? 0,
    name:
      asString(raw["strMonName"]) ??
      defaults?.name ??
      `Monster ${monsterMapId}`,
    race: asString(raw["sRace"]) ?? defaults?.race ?? "",
    state:
      asEntityState(raw["intState"]) ?? defaults?.state ?? EntityState.Idle,
  });
};
