import { LiveShop } from "@lucent/game";
import * as Schema from "effect/Schema";

import { PositiveWireInt, WireBoolean } from "../Coercion";
import type { LiveItem } from "@lucent/game";

export const ShopPayload = Schema.Struct({
  ShopID: PositiveWireInt,
  bHouse: Schema.optionalKey(WireBoolean),
  bLimited: Schema.optionalKey(WireBoolean),
  bMerge: Schema.optionalKey(WireBoolean),
  items: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  sName: Schema.optionalKey(Schema.String),
  sType: Schema.optionalKey(Schema.String),
});
export type ShopPayload = typeof ShopPayload.Type;

export const toShop = (
  payload: ShopPayload,
  items: readonly LiveItem[],
): LiveShop =>
  new LiveShop({
    house: payload.bHouse ?? false,
    id: payload.ShopID,
    items,
    limited: payload.bLimited ?? false,
    merge: (payload.bMerge ?? false) || payload.sType === "Merge",
    name: payload.sName ?? `Shop ${payload.ShopID}`,
  });
