import { LiveItem } from "@lucent/game";
import type { ItemData } from "@lucent/game";
import { Schema } from "effect";

import { PositiveWireInt, WireBoolean, WireInt, WireNumber } from "../Coercion";

export const ItemPayload = Schema.Struct({
  ItemID: PositiveWireInt,
  CharItemID: Schema.optionalKey(PositiveWireInt),
  EnhDPS: Schema.optionalKey(WireNumber),
  EnhID: Schema.optionalKey(PositiveWireInt),
  EnhLvl: Schema.optionalKey(PositiveWireInt),
  EnhPatternID: Schema.optionalKey(PositiveWireInt),
  EnhPID: Schema.optionalKey(PositiveWireInt),
  EnhRng: Schema.optionalKey(WireNumber),
  EnhRty: Schema.optionalKey(WireNumber),
  ShopItemID: Schema.optionalKey(PositiveWireInt),
  bBank: Schema.optionalKey(WireBoolean),
  bCoins: Schema.optionalKey(WireBoolean),
  bEquip: Schema.optionalKey(WireBoolean),
  bHouse: Schema.optionalKey(WireBoolean),
  bTemp: Schema.optionalKey(WireBoolean),
  iCost: Schema.optionalKey(WireNumber),
  iEnh: Schema.optionalKey(PositiveWireInt),
  iQty: Schema.optionalKey(WireInt),
  sDesc: Schema.optionalKey(Schema.String),
  sES: Schema.optionalKey(Schema.String),
  sFile: Schema.optionalKey(Schema.String),
  sLink: Schema.optionalKey(Schema.String),
  sMeta: Schema.optionalKey(Schema.String),
  sName: Schema.optionalKey(Schema.String),
  sType: Schema.optionalKey(Schema.String),
  strES: Schema.optionalKey(Schema.String),
});
export type ItemPayload = typeof ItemPayload.Type;

export const ItemPayloads = Schema.Array(ItemPayload);

const houseCategories = new Set(["House", "Floor Item", "Wall Item"]);

export const toItem = (
  payload: ItemPayload,
  defaults: Partial<ItemData> = {},
): LiveItem => {
  const category = payload.sType ?? defaults.category ?? "";
  const houseItem =
    (payload.bHouse ?? false) ||
    (defaults.houseItem ?? false) ||
    houseCategories.has(category);
  const temporaryItem = payload.bTemp ?? defaults.temporaryItem ?? false;
  const context =
    payload.bBank === true
      ? "bank"
      : (defaults.context ??
        (temporaryItem ? "temporary" : houseItem ? "house" : "inventory"));
  const enhancementId = payload.EnhID ?? payload.iEnh;
  const enhancementPatternId = payload.EnhPatternID ?? payload.EnhPID;
  const enhancement = {
    ...(payload.EnhDPS === undefined ? {} : { dps: payload.EnhDPS }),
    ...(enhancementId === undefined ? {} : { id: enhancementId }),
    ...(payload.EnhLvl === undefined ? {} : { level: payload.EnhLvl }),
    ...(enhancementPatternId === undefined
      ? {}
      : { patternId: enhancementPatternId }),
    ...(payload.EnhRng === undefined ? {} : { range: payload.EnhRng }),
    ...(payload.EnhRty === undefined ? {} : { rarity: payload.EnhRty }),
  };
  const hasEnhancement = Object.keys(enhancement).length > 0;

  return new LiveItem({
    category,
    ...(payload.CharItemID === undefined
      ? defaults.charItemId === undefined
        ? {}
        : { charItemId: defaults.charItemId }
      : { charItemId: payload.CharItemID }),
    coins: payload.bCoins ?? defaults.coins ?? false,
    context,
    cost: payload.iCost ?? defaults.cost ?? 0,
    description: payload.sDesc ?? defaults.description ?? "",
    ...(hasEnhancement ? { enhancement } : {}),
    equipped: payload.bEquip ?? defaults.equipped ?? false,
    equipmentSlot: payload.sES ?? payload.strES ?? defaults.equipmentSlot ?? "",
    file: payload.sFile ?? defaults.file ?? "",
    houseItem,
    itemId: payload.ItemID,
    link: payload.sLink ?? defaults.link ?? "",
    meta: payload.sMeta ?? defaults.meta ?? "",
    name: payload.sName ?? defaults.name ?? `Item ${payload.ItemID}`,
    quantity: Math.max(0, payload.iQty ?? defaults.quantity ?? 1),
    ...(payload.ShopItemID === undefined
      ? defaults.shopItemId === undefined
        ? {}
        : { shopItemId: defaults.shopItemId }
      : { shopItemId: payload.ShopItemID }),
    temporaryItem,
  });
};
