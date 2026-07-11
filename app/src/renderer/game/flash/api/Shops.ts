import type { LiveItem } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireBoolean, WireInt } from "../contract/Coercion";
import { packetData } from "../contract/Packet";
import { ItemPayloads, toItem } from "../contract/payload/Items";
import {
  decodeItemSelector,
  decodeShopSelector,
  quantity,
} from "../domain/Selectors";
import type { Store } from "../state/Store";
import type { Inventory } from "./Inventory";
import type { Wait } from "./Wait";

const decodeShopId = Schema.decodeUnknownOption(PositiveWireInt);
const BuyResponse = Schema.Struct({
  bBank: Schema.optionalKey(WireBoolean),
  bitSuccess: WireBoolean,
  iQty: Schema.optionalKey(WireInt),
});
const decodeBuyResponse = Schema.decodeUnknownOption(BuyResponse);

const selectorFor = (item: LiveItem) =>
  item.shopItemId === undefined
    ? { itemId: item.itemId }
    : { shopItemId: item.shopItemId };

export const makeShops = (
  bridge: BridgeService,
  store: Store,
  inventory: Inventory,
  wait: Wait,
) => {
  const refreshPurchasedContainer = (
    container: "bank" | "house" | "inventory",
  ) => {
    const method =
      container === "bank"
        ? "bank.getItems"
        : container === "house"
          ? "house.getItems"
          : "inventory.getItems";
    return bridge.invoke(method, undefined, ItemPayloads).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (payloads) => {
            const items = payloads.map((payload) =>
              toItem(payload, { context: container }),
            );
            return store.items.replace(container, items);
          },
        }),
      ),
    );
  };

  const get = (selector: unknown) => {
    const decoded = decodeShopSelector(selector);
    return Option.isNone(decoded)
      ? Effect.succeed(null)
      : store.items.get("shop", decoded.value);
  };

  const isOpen = (input?: unknown) => {
    const shopId = input === undefined ? Option.none() : decodeShopId(input);
    if (input !== undefined && Option.isNone(shopId)) {
      return Effect.succeed(false);
    }
    return bridge
      .invoke(
        "shops.isOpen",
        Option.isSome(shopId) ? [shopId.value] : undefined,
        Schema.Boolean,
      )
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              store.shops.get.pipe(
                Effect.map((shop) =>
                  Option.isSome(shopId)
                    ? shop?.id === shopId.value
                    : shop !== null,
                ),
              ),
            onSome: (open) => Effect.succeed(open),
          }),
        ),
      );
  };

  function close(input?: unknown) {
    const shopId = input === undefined ? Option.none() : decodeShopId(input);
    if (input !== undefined && Option.isNone(shopId)) {
      return Effect.succeed(false);
    }
    return Effect.gen(function* () {
      if (!(yield* isOpen(input))) return false;
      const closed = yield* bridge
        .invoke(
          "shops.close",
          Option.isSome(shopId) ? [shopId.value] : undefined,
          Schema.Boolean,
        )
        .pipe(Effect.map(Option.getOrElse(() => false)));
      if (!closed) return false;
      const settled = yield* wait.until(
        isOpen(input).pipe(Effect.map((open) => !open)),
        { timeout: "3 seconds" },
      );
      if (settled) {
        yield* store.shops.set(null);
        yield* store.items.replace("shop", []);
      }
      return settled;
    });
  }

  const load = (input: unknown) => {
    const shopId = decodeShopId(input);
    if (Option.isNone(shopId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (yield* isOpen(shopId.value)) return true;
      const current = yield* store.shops.get;
      if (
        current !== null &&
        current.id !== shopId.value &&
        (yield* isOpen(current.id))
      ) {
        yield* close(current.id);
      }
      if (
        Option.isNone(
          yield* bridge.invoke("shops.load", [shopId.value], Schema.Void),
        )
      ) {
        return false;
      }
      return yield* wait.until(
        Effect.all([store.shops.get, isOpen(shopId.value)]).pipe(
          Effect.map(([shop, open]) => shop?.id === shopId.value && open),
        ),
        { timeout: "5 seconds" },
      );
    });
  };

  const canBuy = (selector: unknown, options?: { quantity?: number }) =>
    get(selector).pipe(
      Effect.flatMap((item) =>
        item === null
          ? Effect.succeed(false)
          : bridge
              .invoke(
                "shops.canBuyItem",
                [selectorFor(item), quantity(options?.quantity)],
                Schema.Boolean,
              )
              .pipe(Effect.map(Option.getOrElse(() => false))),
      ),
    );

  const buy = (selector: unknown, options?: { quantity?: number }) =>
    get(selector).pipe(
      Effect.flatMap((item) => {
        if (item === null) return Effect.succeed(false);
        const requested = quantity(options?.quantity);
        return Effect.gen(function* () {
          if (!(yield* wait.forGameAction("buyItem"))) return false;
          if (!(yield* canBuy(selectorFor(item), { quantity: requested }))) {
            return false;
          }
          const startingQuantities = yield* Effect.all({
            bank: store.items.quantity("bank", item.itemId),
            house: store.items.quantity("house", item.itemId),
            inventory: store.items.quantity("inventory", item.itemId),
          });
          let response: typeof BuyResponse.Type | undefined;
          const packet = yield* wait.forPacket(
            {
              command: "buyItem",
              direction: "extension",
              predicate: (candidate) => {
                const decoded = decodeBuyResponse(packetData(candidate));
                if (Option.isNone(decoded)) return false;
                response = decoded.value;
                return true;
              },
              wireType: "json",
            },
            {
              shouldAwait: Option.isSome,
              timeout: "5 seconds",
              trigger: bridge.invoke(
                "shops.buy",
                [selectorFor(item), requested],
                Schema.Void,
              ),
            },
          );
          if (packet === null || response?.bitSuccess !== true) return false;

          const container = response.bBank
            ? "bank"
            : item.houseItem
              ? "house"
              : "inventory";
          yield* refreshPurchasedContainer(container);
          const owned = yield* store.items.quantity(container, item.itemId);
          return owned >= startingQuantities[container] + requested;
        });
      }),
    );

  const sell = (selector: unknown, options?: { quantity?: number }) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(false);
    return inventory.get(decoded.value).pipe(
      Effect.flatMap((item) => {
        if (item === null) return Effect.succeed(false);
        const requested = quantity(options?.quantity);
        if (item.quantity < requested) return Effect.succeed(false);
        return Effect.gen(function* () {
          if (!(yield* wait.forGameAction("sellItem"))) return false;
          const sold = yield* bridge
            .invoke("shops.sell", [decoded.value, requested], Schema.Boolean)
            .pipe(Effect.map(Option.getOrElse(() => false)));
          if (!sold) return false;
          return yield* wait.until(
            inventory
              .get(item.itemId)
              .pipe(
                Effect.map(
                  (current) =>
                    current === null ||
                    current.quantity <= item.quantity - requested,
                ),
              ),
            { timeout: "5 seconds" },
          );
        });
      }),
    );
  };

  const getAll = () => store.items.getAll("shop");
  const getInfo = () => store.shops.get;

  const getMaxBuyQuantity = (selector: unknown) =>
    get(selector).pipe(
      Effect.flatMap((item) =>
        item === null
          ? Effect.succeed(0)
          : bridge
              .invoke("shops.getMaxBuyQuantity", [selectorFor(item)], WireInt)
              .pipe(Effect.map(Option.getOrElse(() => 0))),
      ),
    );

  const isMergeShop = () =>
    bridge.invoke("shops.isMergeShop", undefined, Schema.Boolean).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            store.shops.get.pipe(Effect.map((shop) => shop?.merge ?? false)),
          onSome: (merge) => Effect.succeed(merge),
        }),
      ),
    );

  const loadArmorCustomize = () =>
    bridge
      .invoke("shops.loadArmorCustomize", undefined, Schema.Void)
      .pipe(Effect.asVoid);

  const loadHairShop = (input: unknown) => {
    const shopId = decodeShopId(input);
    return Option.isNone(shopId)
      ? Effect.void
      : bridge
          .invoke("shops.loadHairShop", [shopId.value], Schema.Void)
          .pipe(Effect.asVoid);
  };

  return {
    buy,
    canBuy,
    close,
    get,
    getAll,
    getInfo,
    getMaxBuyQuantity,
    isMergeShop,
    isOpen,
    load,
    loadArmorCustomize,
    loadHairShop,
    sell,
  };
};

export type Shops = ReturnType<typeof makeShops>;
