import { Collection } from "@lucent/collection";
import type { GameAction, ShopInfo, ShopItem } from "@lucent/game";
import { equalsIgnoreCase } from "@lucent/shared/string";
import { Effect, Layer, Option, Ref } from "effect";
import { makeShopItemCache } from "../ItemCache";
import { asNumber, asRecord, asString } from "../PacketPayload";
import { Bridge } from "../Services/Bridge";
import type { BridgeEffect } from "../Services/Bridge";
import { Packet } from "../Services/Packet";
import { Shops } from "../Services/Shops";
import type {
  InventoryItemSelector,
  ShopItemSelector,
  ShopsShape,
  ShopQuantityOptions,
} from "../Services/Shops";
import { Wait } from "../Services/Wait";

const asShopInfo = (value: unknown): ShopInfo | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const shopinfo = asRecord(record["shopinfo"]);
  if (!shopinfo) {
    return null;
  }

  const items = shopinfo["items"];
  if (!Array.isArray(items)) {
    return null;
  }

  return shopinfo as ShopInfo;
};

const normalizeQuantity = (
  options: ShopQuantityOptions | undefined,
): number | undefined => {
  const quantity = options?.quantity;
  if (quantity === undefined || !Number.isFinite(quantity)) {
    return undefined;
  }

  const normalized = Math.trunc(quantity);
  return normalized > 0 ? normalized : undefined;
};

const normalizeShopItemId = (value: string | number | undefined) =>
  value === undefined ? undefined : String(value).trim();

const getShopItemId = (item: ShopItem): string | undefined => {
  const id = normalizeShopItemId(item.data.ShopItemID);
  return id === "" ? undefined : id;
};

const matchesShopItemSelector = (
  item: ShopItem,
  selector: ShopItemSelector,
): boolean => {
  if (selector.name !== undefined && !equalsIgnoreCase(item.name, selector.name)) {
    return false;
  }

  if (selector.itemId !== undefined && item.id !== selector.itemId) {
    return false;
  }

  const selectorShopItemId = normalizeShopItemId(selector.shopItemId);
  if (
    selectorShopItemId !== undefined &&
    getShopItemId(item) !== selectorShopItemId
  ) {
    return false;
  }

  return true;
};

const toShopItemsCollection = (
  items: Iterable<ShopItem>,
): Collection<string, ShopItem> => {
  const collection = new Collection<string, ShopItem>();
  for (const item of items) {
    const id = getShopItemId(item);
    if (id !== undefined) {
      collection.set(id, item);
    }
  }

  return collection;
};

const make = Effect.gen(function* () {
  const bridge = yield* Bridge;
  const packet = yield* Packet;
  const wait = yield* Wait;

  const itemCache = yield* makeShopItemCache;

  const shopInfoRef = yield* Ref.make<ShopInfo | null>(null);

  const runFork = Effect.runForkWith(yield* Effect.services());

  const setShopInfo = (value: unknown) =>
    Effect.gen(function* () {
      const info = asShopInfo(value);
      if (!info) {
        return;
      }

      yield* Ref.set(shopInfoRef, info);
      yield* itemCache.fromUnknownArray(info.items);
    });

  yield* packet.jsonScoped("loadShop", (packet) => setShopInfo(packet.data));

  const dispose = yield* bridge.onConnection((status) => {
    if (status === "OnConnectionLost") {
      runFork(
        Effect.gen(function* () {
          yield* Ref.set(shopInfoRef, null);
          yield* itemCache.clear;
        }),
      );
    }
  });

  yield* Effect.addFinalizer(() => Effect.sync(dispose));

  const runWhenActionAvailable = (
    gameAction: GameAction,
    operation: BridgeEffect<boolean>,
  ): BridgeEffect<boolean> =>
    Effect.gen(function* () {
      const isAvailable = yield* wait.forGameAction(gameAction);
      if (!isAvailable) {
        return false;
      }

      return yield* operation;
    });

  const close: ShopsShape["close"] = (shopId) =>
    shopId === undefined
      ? bridge.call("shops.close")
      : bridge.call("shops.close", [shopId]);

  const getInfo: ShopsShape["getInfo"] = () => Ref.get(shopInfoRef);

  const getShopItems = () =>
    Effect.gen(function* () {
      const info = yield* getInfo();
      if (!info) {
        return [];
      }

      return yield* itemCache.fromUnknownArray(info.items);
    });

  const getMatchingShopItems = (selector?: ShopItemSelector) =>
    Effect.map(getShopItems(), (items) =>
      selector === undefined
        ? Array.from(items)
        : items.filter((item) => matchesShopItemSelector(item, selector)),
    );

  const getSingleShopItem = (selector: ShopItemSelector) =>
    Effect.map(getMatchingShopItems(selector), (items) => {
      const item = items[0];
      return items.length === 1 && item !== undefined
        ? Option.some(item)
        : Option.none<ShopItem>();
    });

  const getItems: ShopsShape["getItems"] = (selector) =>
    Effect.map(getMatchingShopItems(selector), toShopItemsCollection);

  const getItem: ShopsShape["getItem"] = (selector) =>
    getSingleShopItem(selector);

  const getMaxBuyQuantity: ShopsShape["getMaxBuyQuantity"] = (selector) =>
    Effect.gen(function* () {
      const item = yield* getSingleShopItem(selector);
      if (Option.isNone(item)) {
        return 0;
      }

      const shopItemId = getShopItemId(item.value);
      if (shopItemId === undefined) {
        return 0;
      }

      return yield* bridge.call("shops.getMaxBuyQuantityByShopItemId", [
        shopItemId,
      ]);
    });

  const canBuy: ShopsShape["canBuy"] = (selector, options) =>
    Effect.gen(function* () {
      const item = yield* getSingleShopItem(selector);
      if (Option.isNone(item)) {
        return false;
      }

      const shopItemId = getShopItemId(item.value);
      if (shopItemId === undefined) {
        return false;
      }

      const quantity = normalizeQuantity(options);
      if (quantity === undefined) {
        return yield* bridge.call("shops.canBuyByShopItemId", [shopItemId]);
      }

      return yield* bridge.call("shops.canBuyByShopItemId", [
        shopItemId,
        quantity,
      ]);
    });

  const buy: ShopsShape["buy"] = (selector, options) =>
    Effect.gen(function* () {
      const item = yield* getSingleShopItem(selector);
      if (Option.isNone(item)) {
        return false;
      }

      const shopItemId = getShopItemId(item.value);
      if (shopItemId === undefined) {
        return false;
      }

      const quantity = normalizeQuantity(options);
      return yield* runWhenActionAvailable(
        "buyItem",
        quantity === undefined
          ? bridge.call("shops.buyByShopItemId", [shopItemId])
          : bridge.call("shops.buyByShopItemId", [shopItemId, quantity]),
      );
    });

  const isOpen: ShopsShape["isOpen"] = (shopId) =>
    shopId === undefined
      ? bridge.call("shops.isOpen")
      : bridge.call("shops.isOpen", [shopId]);

  const isMergeShop: ShopsShape["isMergeShop"] = () =>
    bridge.call("shops.isMergeShop");

  const load: ShopsShape["load"] = (shopId) =>
    Effect.gen(function* () {
      const info = yield* Ref.get(shopInfoRef);
      const currentShopId = asNumber(info?.ShopID);
      if (currentShopId !== undefined && currentShopId !== shopId) {
        yield* close(currentShopId);
      }

      yield* bridge.call("shops.load", [shopId]);
    });

  const loadArmorCustomize: ShopsShape["loadArmorCustomize"] = () =>
    bridge.call("shops.loadArmorCustomize");

  const loadHairShop: ShopsShape["loadHairShop"] = (shopId) =>
    bridge.call("shops.loadHairShop", [shopId]);

  const selectorMatchesInventoryItem = (
    item: unknown,
    selector: InventoryItemSelector,
  ) => {
    const record = asRecord(item);
    if (!record) {
      return false;
    }

    const itemId = asNumber(record["ItemID"]);
    if (selector.itemId !== undefined && itemId !== selector.itemId) {
      return false;
    }

    const name = asString(record["sName"]);
    if (
      selector.name !== undefined &&
      (name === undefined || !equalsIgnoreCase(name, selector.name))
    ) {
      return false;
    }

    return true;
  };

  const sell: ShopsShape["sell"] = (selector, options) =>
    Effect.gen(function* () {
      const quantity = normalizeQuantity(options);
      if (selector.name !== undefined && selector.itemId !== undefined) {
        const item = yield* bridge.call("inventory.getItem", [
          selector.itemId,
        ]);
        if (!selectorMatchesInventoryItem(item, selector)) {
          return false;
        }
      }

      if (selector.itemId !== undefined) {
        return yield* runWhenActionAvailable(
          "sellItem",
          quantity === undefined
            ? bridge.call("shops.sellById", [selector.itemId])
            : bridge.call("shops.sellById", [selector.itemId, quantity]),
        );
      }

      if (selector.name === undefined) {
        return false;
      }

      return yield* runWhenActionAvailable(
        "sellItem",
        quantity === undefined
          ? bridge.call("shops.sellByName", [selector.name])
          : bridge.call("shops.sellByName", [selector.name, quantity]),
      );
    });

  return {
    buy,
    canBuy,
    close,
    getInfo,
    getItem,
    getItems,
    getMaxBuyQuantity,
    isOpen,
    isMergeShop,
    load,
    loadArmorCustomize,
    loadHairShop,
    sell,
  } satisfies ShopsShape;
});

export const ShopsLive = Layer.effect(Shops, make);
