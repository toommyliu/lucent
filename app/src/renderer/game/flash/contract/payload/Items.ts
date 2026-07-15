import { LiveItem } from "@lucent/game";
import type { ItemData } from "@lucent/game";
import { Schema } from "effect";

import {
  NonNegativeWireInt,
  PositiveWireInt,
  WireBoolean,
  WireInt,
  WireNumber,
} from "../Coercion";

export const ItemPayload = Schema.Struct({
  ItemID: PositiveWireInt,
  CharItemID: Schema.optionalKey(PositiveWireInt),
  EnhDPS: Schema.optionalKey(WireNumber),
  EnhID: Schema.optionalKey(WireInt),
  EnhLvl: Schema.optionalKey(NonNegativeWireInt),
  EnhPatternID: Schema.optionalKey(NonNegativeWireInt),
  EnhPID: Schema.optionalKey(NonNegativeWireInt),
  EnhRng: Schema.optionalKey(WireNumber),
  EnhRty: Schema.optionalKey(WireNumber),
  ItemProcID: Schema.optionalKey(NonNegativeWireInt),
  PatternID: Schema.optionalKey(NonNegativeWireInt),
  ProcID: Schema.optionalKey(NonNegativeWireInt),
  ShopItemID: Schema.optionalKey(PositiveWireInt),
  bBank: Schema.optionalKey(WireBoolean),
  bCoins: Schema.optionalKey(WireBoolean),
  bEquip: Schema.optionalKey(WireBoolean),
  bHouse: Schema.optionalKey(WireBoolean),
  bTemp: Schema.optionalKey(WireBoolean),
  bUpg: Schema.optionalKey(WireBoolean),
  bWear: Schema.optionalKey(WireBoolean),
  iCost: Schema.optionalKey(WireNumber),
  iEnh: Schema.optionalKey(WireInt),
  iLvl: Schema.optionalKey(NonNegativeWireInt),
  iQty: Schema.optionalKey(WireInt),
  iQtyNow: Schema.optionalKey(WireInt),
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
  const rawEnhancementId = payload.EnhID ?? payload.iEnh;
  const rawEnhancementLevel =
    payload.EnhLvl ?? (defaults.context === "shop" ? payload.iLvl : undefined);
  const rawEnhancementPatternId =
    payload.EnhPatternID ?? payload.EnhPID ?? payload.PatternID;
  const rawEnhancementProcId = payload.ItemProcID ?? payload.ProcID;
  const enhancementId =
    rawEnhancementId === undefined || rawEnhancementId <= 0
      ? undefined
      : rawEnhancementId;
  const enhancementLevel =
    rawEnhancementLevel === undefined || rawEnhancementLevel === 0
      ? undefined
      : rawEnhancementLevel;
  const enhancementPatternId =
    rawEnhancementPatternId === undefined || rawEnhancementPatternId === 0
      ? undefined
      : rawEnhancementPatternId;
  const enhancementProcId =
    rawEnhancementProcId === undefined || rawEnhancementProcId === 0
      ? undefined
      : rawEnhancementProcId;
  const enhancement = {
    ...(payload.EnhDPS === undefined ? {} : { dps: payload.EnhDPS }),
    ...(enhancementId === undefined ? {} : { id: enhancementId }),
    ...(enhancementLevel === undefined ? {} : { level: enhancementLevel }),
    ...(enhancementPatternId === undefined
      ? {}
      : { patternId: enhancementPatternId }),
    ...(enhancementProcId === undefined ? {} : { procId: enhancementProcId }),
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
    memberOnly: payload.bUpg ?? defaults.memberOnly ?? false,
    meta: payload.sMeta ?? defaults.meta ?? "",
    name: payload.sName ?? defaults.name ?? `Item ${payload.ItemID}`,
    quantity: Math.max(
      0,
      payload.iQtyNow ?? payload.iQty ?? defaults.quantity ?? 1,
    ),
    ...(payload.ShopItemID === undefined
      ? defaults.shopItemId === undefined
        ? {}
        : { shopItemId: defaults.shopItemId }
      : { shopItemId: payload.ShopItemID }),
    temporaryItem,
    wearable: payload.bWear !== undefined,
  });
};
