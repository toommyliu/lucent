import { Data, Effect, ServiceMap } from "effect";
import type { ShopInfo, ShopItem } from "@lucent/game";
import type { Collection } from "@lucent/collection";
import type { Option } from "effect";
import type { BridgeEffect } from "./Bridge";
import type { BridgeError } from "./Bridge";

export type ShopItemSelector =
  | {
      readonly name: string;
      readonly itemId?: number;
      readonly shopItemId?: string | number;
    }
  | {
      readonly itemId: number;
      readonly name?: string;
      readonly shopItemId?: string | number;
    }
  | {
      readonly shopItemId: string | number;
      readonly name?: string;
      readonly itemId?: number;
    };

export type InventoryItemSelector =
  | {
      readonly name: string;
      readonly itemId?: number;
    }
  | {
      readonly itemId: number;
      readonly name?: string;
    };

export interface ShopQuantityOptions {
  readonly quantity?: number;
}

export interface ShopItemMatchSummary {
  readonly name: string;
  readonly itemId: number;
  readonly shopItemId?: string;
}

export interface ShopItemSelectorAmbiguousError {
  readonly _tag: "ShopItemSelectorAmbiguousError";
  readonly message: string;
  readonly selector: ShopItemSelector;
  readonly matches: readonly ShopItemMatchSummary[];
}

export class ShopItemSelectorAmbiguous extends Data.TaggedError(
  "ShopItemSelectorAmbiguousError",
)<Omit<ShopItemSelectorAmbiguousError, "_tag">> {}

export type ShopItemSelectionEffect<A> = Effect.Effect<
  A,
  BridgeError | ShopItemSelectorAmbiguousError
>;

export interface ShopsShape {
  buy(
    selector: ShopItemSelector,
    options?: ShopQuantityOptions,
  ): ShopItemSelectionEffect<boolean>;
  canBuy(
    selector: ShopItemSelector,
    options?: ShopQuantityOptions,
  ): ShopItemSelectionEffect<boolean>;
  close(shopId?: number): BridgeEffect<boolean>;
  getInfo(): BridgeEffect<ShopInfo | null>;
  getItem(
    selector: ShopItemSelector,
  ): ShopItemSelectionEffect<Option.Option<ShopItem>>;
  getItems(): BridgeEffect<Collection<string, ShopItem>>;
  getMaxBuyQuantity(
    selector: ShopItemSelector,
  ): ShopItemSelectionEffect<number>;
  isOpen(shopId?: number): BridgeEffect<boolean>;
  isMergeShop(): BridgeEffect<boolean>;
  load(shopId: number): BridgeEffect<void>;
  loadArmorCustomize(): BridgeEffect<void>;
  loadHairShop(shopId: number): BridgeEffect<void>;
  sell(
    selector: InventoryItemSelector,
    options?: ShopQuantityOptions,
  ): BridgeEffect<boolean>;
}

export class Shops extends ServiceMap.Service<Shops, ShopsShape>()(
  "flash/Services/Shops",
) {}
