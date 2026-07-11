import { Context, Effect, Layer } from "effect";

import type {
  ItemSelector,
  QuantityOptions,
  Shop,
  Item,
  ShopItemSelector,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import { asPositiveInt } from "../payload";
import { normalizeItemSelector, normalizeQuantity } from "../selectors";
import { ItemsState } from "../state/Items";
import { ShopsState } from "../state/Shops";
import { InventoryApi } from "./Inventory";
import { WaitApi } from "./Wait";

export interface ShopsApiShape {
  readonly buy: (
    selector: ShopItemSelector,
    options?: QuantityOptions,
  ) => Effect.Effect<boolean>;
  readonly canBuy: (
    selector: ShopItemSelector,
    options?: QuantityOptions,
  ) => Effect.Effect<boolean>;
  readonly close: (shopId?: number) => Effect.Effect<boolean>;
  readonly get: (selector: ShopItemSelector) => Effect.Effect<Item | null>;
  readonly getAll: () => Effect.Effect<readonly Item[]>;
  readonly getInfo: () => Effect.Effect<Shop | null>;
  readonly getMaxBuyQuantity: (
    selector: ShopItemSelector,
  ) => Effect.Effect<number>;
  readonly isMergeShop: () => Effect.Effect<boolean>;
  readonly isOpen: (shopId?: number) => Effect.Effect<boolean>;
  readonly load: (shopId: number) => Effect.Effect<boolean>;
  readonly loadArmorCustomize: () => Effect.Effect<void>;
  readonly loadHairShop: (shopId: number) => Effect.Effect<void>;
  readonly sell: (
    selector: ItemSelector,
    options?: QuantityOptions,
  ) => Effect.Effect<boolean>;
}

export class ShopsApi extends Context.Service<ShopsApi, ShopsApiShape>()(
  "lucent/game/flash/api/Shops",
) {}

const quantityFromOptions = (options?: QuantityOptions) =>
  normalizeQuantity(options?.quantity);

export const layer = Layer.effect(
  ShopsApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const inventory = yield* InventoryApi;
    const items = yield* ItemsState;
    const shops = yield* ShopsState;
    const wait = yield* WaitApi;

    const isOpen: ShopsApiShape["isOpen"] = (shopId) =>
      shopId === undefined
        ? bridge.call("shops.isOpen")
        : bridge.call("shops.isOpen", [shopId]);

    const close: ShopsApiShape["close"] = (shopId) =>
      Effect.gen(function* () {
        if (!(yield* isOpen(shopId))) {
          return false;
        }

        const closed = yield* shopId === undefined
          ? bridge.call("shops.close")
          : bridge.call("shops.close", [shopId]);
        return (
          closed &&
          (yield* wait.until(isOpen(shopId).pipe(Effect.map((open) => !open)), {
            timeout: "3 seconds",
          }))
        );
      });

    const canBuy: ShopsApiShape["canBuy"] = (selector, options) =>
      Effect.gen(function* () {
        const item = yield* shops.getOne(selector);
        if (item === null) {
          return false;
        }

        const bridgeSelector =
          item.shopItemId === undefined
            ? { itemId: item.itemId }
            : { shopItemId: item.shopItemId };
        return yield* bridge.call("shops.canBuyItem", [
          bridgeSelector,
          quantityFromOptions(options),
        ]);
      });

    const buy: ShopsApiShape["buy"] = (selector, options) =>
      Effect.gen(function* () {
        const item = yield* shops.getOne(selector);
        if (item === null) {
          return false;
        }

        const quantity = quantityFromOptions(options);
        const actionReady = yield* wait.forGameAction("buyItem");
        if (!actionReady || !(yield* canBuy(selector, { quantity }))) {
          return false;
        }

        const startingQuantity = yield* items.getOwnedQuantity({
          itemId: item.itemId,
        });
        const bridgeSelector =
          item.shopItemId === undefined
            ? { itemId: item.itemId }
            : { shopItemId: item.shopItemId };
        yield* bridge.call("shops.buy", [bridgeSelector, quantity]);
        return yield* wait.until(
          items
            .getOwnedQuantity({ itemId: item.itemId })
            .pipe(Effect.map((owned) => owned >= startingQuantity + quantity)),
          { timeout: "5 seconds" },
        );
      });

    const sell: ShopsApiShape["sell"] = (selector, options) =>
      Effect.gen(function* () {
        const item = yield* inventory.get(selector);
        if (item === null) {
          return false;
        }

        const normalized = normalizeItemSelector(selector);
        if (normalized === null) {
          return false;
        }

        const actionReady = yield* wait.forGameAction("sellItem");
        if (!actionReady) {
          return false;
        }

        const quantity = quantityFromOptions(options);
        const startingQuantity = item.quantity;
        const expectedMaximumQuantity = Math.max(
          0,
          startingQuantity - quantity,
        );
        const sold = yield* bridge.call("shops.sell", [normalized, quantity]);
        if (!sold) {
          return false;
        }

        return yield* wait.until(
          Effect.gen(function* () {
            if (!(yield* bridge.call("auth.isLoggedIn"))) {
              return false;
            }
            const current = yield* inventory.get({ itemId: item.itemId });
            return (
              current === null || current.quantity <= expectedMaximumQuantity
            );
          }),
          { timeout: "5 seconds" },
        );
      });

    const load: ShopsApiShape["load"] = (shopId) =>
      Effect.gen(function* () {
        const id = asPositiveInt(shopId);
        if (id === undefined) {
          return false;
        }

        const info = yield* shops.getInfo();
        if (info !== null && info.id !== id && (yield* isOpen(info.id))) {
          yield* close(info.id);
        }

        yield* bridge.call("shops.load", [id]);
        return yield* wait.until(
          Effect.gen(function* () {
            const loaded = yield* shops.getInfo();
            return loaded?.id === id && (yield* isOpen(id));
          }),
          { timeout: "5 seconds" },
        );
      });

    return ShopsApi.of({
      buy,
      canBuy,
      close,
      get: shops.getOne,
      getAll: shops.getAll,
      getInfo: shops.getInfo,
      getMaxBuyQuantity: (selector) =>
        Effect.gen(function* () {
          const item = yield* shops.getOne(selector);
          if (item === null) {
            return 0;
          }

          const bridgeSelector =
            item.shopItemId === undefined
              ? { itemId: item.itemId }
              : { shopItemId: item.shopItemId };
          return yield* bridge.call("shops.getMaxBuyQuantity", [
            bridgeSelector,
          ]);
        }),
      isMergeShop: () => bridge.call("shops.isMergeShop"),
      isOpen,
      load,
      loadArmorCustomize: () => bridge.call("shops.loadArmorCustomize"),
      loadHairShop: (shopId) =>
        asPositiveInt(shopId) === undefined
          ? Effect.void
          : bridge.call("shops.loadHairShop", [Math.trunc(shopId)]),
      sell,
    });
  }),
);
