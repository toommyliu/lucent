import { LiveShop } from "@lucent/game";
import { Schema } from "effect";

import { PositiveWireInt, WireBoolean } from "../Coercion";
import { ItemPayload, toItem } from "./Items";

export const ShopPayload = Schema.Struct({
  ShopID: PositiveWireInt,
  bHouse: Schema.optionalKey(WireBoolean),
  bLimited: Schema.optionalKey(WireBoolean),
  bMerge: Schema.optionalKey(WireBoolean),
  items: Schema.optionalKey(Schema.Array(ItemPayload)),
  sName: Schema.optionalKey(Schema.String),
  sType: Schema.optionalKey(Schema.String),
});
export type ShopPayload = typeof ShopPayload.Type;

export const toShop = (payload: ShopPayload): LiveShop =>
  new LiveShop({
    house: payload.bHouse ?? false,
    id: payload.ShopID,
    items: (payload.items ?? []).map((item) =>
      toItem(item, { context: "shop" }),
    ),
    limited: payload.bLimited ?? false,
    merge: (payload.bMerge ?? false) || payload.sType === "Merge",
    name: payload.sName ?? `Shop ${payload.ShopID}`,
  });
