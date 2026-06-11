import { Collection } from "@lucent/collection";
import type { GameAction, ShopInfo, ShopItem } from "@lucent/game";
import { equalsIgnoreCase } from "@lucent/shared/string";
import { Deferred, Effect, Layer, Option, Ref } from "effect";
import { makeShopItemCache } from "../ItemCache";
import { asNumber, asRecord, asString } from "../PacketPayload";
import { Bridge } from "../Services/Bridge";
import type { BridgeEffect } from "../Services/Bridge";
import { Inventory } from "../Services/Inventory";
import { Packet } from "../Services/Packet";
import { Shops } from "../Services/Shops";
import type {
  InventoryItemSelector,
  ShopItemMatchSummary,
  ShopItemSelector,
  ShopsShape,
  ShopQuantityOptions,
} from "../Services/Shops";
import { ShopItemSelectorAmbiguous } from "../Services/Shops";
import { Wait } from "../Services/Wait";

const BUY_ITEM_RESPONSE_TIMEOUT = "5 seconds";
const BUY_ITEM_SETTLEMENT_TIMEOUT = "5 seconds";

interface BuyItemResponse {
  readonly itemId?: number;
  readonly quantity?: number;
  readonly success: boolean;
}

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
  if (
    selector.name !== undefined &&
    !equalsIgnoreCase(item.name, selector.name)
  ) {
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

const toShopItemMatchSummary = (item: ShopItem): ShopItemMatchSummary => {
  const shopItemId = getShopItemId(item);

  return {
    name: item.name,
    itemId: item.id,
    ...(shopItemId !== undefined ? { shopItemId } : null),
  };
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

const asBuyItemResponse = (value: unknown): BuyItemResponse | undefined => {
  const payload = asRecord(value);
  if (!payload) {
    return undefined;
  }

  const bitSuccess = asNumber(payload["bitSuccess"]);
  if (bitSuccess === undefined) {
    return undefined;
  }

  const itemId = asNumber(payload["ItemID"]);
  const quantity = asNumber(payload["iQty"]);

  return {
    ...(itemId !== undefined ? { itemId } : null),
    ...(quantity !== undefined ? { quantity } : null),
    success: bitSuccess === 1,
  };
};

const responseMatchesBuyItem = (
  response: BuyItemResponse,
  itemId: number,
): boolean => {
  if (response.itemId !== undefined) {
    return response.itemId === itemId;
  }

  return !response.success;
};

const make = Effect.gen(function* () {
  const bridge = yield* Bridge;
  const inventory = yield* Inventory;
  const packets = yield* Packet;
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

  yield* packets.jsonScoped("loadShop", (packet) => setShopInfo(packet.data));

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
    Effect.flatMap(getMatchingShopItems(selector), (items) => {
      const item = items[0];
      if (items.length === 0 || item === undefined) {
        return Effect.succeed(Option.none<ShopItem>());
      }

      if (items.length === 1) {
        return Effect.succeed(Option.some(item));
      }

      return Effect.fail(
        new ShopItemSelectorAmbiguous({
          message: "Shop item selector matched multiple items.",
          selector,
          matches: items.map(toShopItemMatchSummary),
        }),
      );
    });

  const getItems: ShopsShape["getItems"] = () =>
    Effect.map(getShopItems(), toShopItemsCollection);

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

  const confirmBuyItemResponse = (
    itemId: number,
    request: BridgeEffect<void>,
  ) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<BuyItemResponse>();
      let observedResponses = 0;
      let lastResponse: BuyItemResponse | undefined;
      const dispose = yield* packets.json("buyItem", (packet) =>
        Effect.gen(function* () {
          const response = asBuyItemResponse(packet.data);
          if (response === undefined) {
            return;
          }

          observedResponses++;
          lastResponse = response;
          if (!responseMatchesBuyItem(response, itemId)) {
            return;
          }

          yield* Deferred.succeed(result, response).pipe(Effect.asVoid);
        }),
      );

      return yield* Effect.gen(function* () {
        yield* request;

        const response = yield* Deferred.await(result).pipe(
          Effect.timeoutOption(BUY_ITEM_RESPONSE_TIMEOUT),
        );
        if (Option.isNone(response)) {
          yield* Effect.logWarning({
            message: "shop buyItem response timed out",
            expectedItemId: itemId,
            observedResponses,
            lastResponse: lastResponse ?? null,
          });
        }

        return response;
      }).pipe(Effect.ensuring(Effect.sync(dispose)));
    });

  const waitForBuySettlement = (
    item: ShopItem,
    response: BuyItemResponse,
    currentQuantity: number,
    buyQuantity: number,
  ) =>
    Effect.gen(function* () {
      if (item.isTemp()) {
        return;
      }

      const responseQuantity =
        response.quantity !== undefined && response.quantity > 0
          ? Math.trunc(response.quantity)
          : buyQuantity;
      const targetQuantity = currentQuantity + responseQuantity;
      const settled = yield* wait.until(
        inventory.contains(item.id, targetQuantity),
        { timeout: BUY_ITEM_SETTLEMENT_TIMEOUT },
      );
      if (!settled) {
        yield* Effect.logWarning({
          message: "shop buy succeeded but inventory settlement timed out",
          itemId: item.id,
          itemName: item.name,
          targetQuantity,
        });
      }
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
      const buyQuantity = quantity ?? 1;
      const actionAvailable = yield* wait.forGameAction("buyItem");
      if (!actionAvailable) {
        return false;
      }

      const buyable =
        quantity === undefined
          ? yield* bridge.call("shops.canBuyByShopItemId", [shopItemId])
          : yield* bridge.call("shops.canBuyByShopItemId", [
              shopItemId,
              quantity,
            ]);
      if (!buyable) {
        return false;
      }

      const currentItem = yield* inventory.getItem(item.value.id);
      const cachedCurrentQuantity = currentItem?.quantity ?? 0;
      const currentQuantity =
        cachedCurrentQuantity > 0 &&
        (yield* inventory.contains(item.value.id, cachedCurrentQuantity))
          ? cachedCurrentQuantity
          : 0;

      const response = yield* confirmBuyItemResponse(
        item.value.id,
        quantity === undefined
          ? bridge.call("shops.buyByShopItemId", [shopItemId])
          : bridge.call("shops.buyByShopItemId", [shopItemId, quantity]),
      );

      if (Option.isNone(response) || !response.value.success) {
        return false;
      }

      yield* waitForBuySettlement(
        item.value,
        response.value,
        currentQuantity,
        buyQuantity,
      );
      return true;
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
        const item = yield* bridge.call("inventory.getItem", [selector.itemId]);
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
