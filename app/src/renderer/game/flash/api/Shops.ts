import { Context, Effect, Layer } from "effect";

import type {
  ItemSelector,
  QuantityOptions,
  ShopInfoRecord,
  ShopItemRecord,
  ShopItemSelector,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import { asBoolean, asPositiveInt, asRecord } from "../payload";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { normalizeItemSelector, normalizeQuantity } from "../selectors";
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
  readonly get: (
    selector: ShopItemSelector,
  ) => Effect.Effect<ShopItemRecord | null>;
  readonly getAll: Effect.Effect<readonly ShopItemRecord[]>;
  readonly getInfo: Effect.Effect<ShopInfoRecord | null>;
  readonly getMaxBuyQuantity: (
    selector: ShopItemSelector,
  ) => Effect.Effect<number>;
  readonly isMergeShop: Effect.Effect<boolean>;
  readonly isOpen: (shopId?: number) => Effect.Effect<boolean>;
  readonly load: (shopId: number) => Effect.Effect<boolean>;
  readonly loadArmorCustomize: Effect.Effect<void>;
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
    const protocol = yield* FlashProtocol;
    const shops = yield* ShopsState;
    const wait = yield* WaitApi;

    const isOpen: ShopsApiShape["isOpen"] = (shopId) =>
      shopId === undefined
        ? bridge.call("shops.isOpen")
        : bridge.call("shops.isOpen", [shopId]);

    const close: ShopsApiShape["close"] = (shopId) =>
      shopId === undefined
        ? bridge.call("shops.close")
        : bridge.call("shops.close", [shopId]);

    const canBuy: ShopsApiShape["canBuy"] = (selector, options) =>
      Effect.gen(function* () {
        const item = yield* shops.getOne(selector);
        if (item === null) {
          return false;
        }

        const bridgeSelector =
          item.shopItemId === undefined
            ? { itemId: item.itemId }
            : { shopItemId: Number(item.shopItemId) };
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

        const current = yield* inventory.get({ itemId: item.itemId });
        const startingQuantity = current?.quantity ?? 0;
        const bridgeSelector =
          item.shopItemId === undefined
            ? { itemId: item.itemId }
            : { shopItemId: Number(item.shopItemId) };
        yield* bridge.call("shops.buy", [bridgeSelector, quantity]);
        const packet = yield* protocol.oncePacket(
          { command: "buyItem" },
          { timeout: "5 seconds" },
        );
        const payload =
          packet !== null && packet.direction !== "client"
            ? asRecord(packet.data)
            : null;
        if (packet === null || asBoolean(payload?.["bitSuccess"]) === false) {
          return false;
        }

        if (item.temp || item.virtual) {
          return true;
        }

        return yield* wait.until(
          inventory.contains(
            { itemId: item.itemId },
            startingQuantity + quantity,
          ),
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
        const sold = yield* bridge.call("shops.sell", [normalized, quantity]);
        if (!sold) {
          return false;
        }

        const packet = yield* protocol.oncePacket(
          { command: "sellItem" },
          { timeout: "5 seconds" },
        );
        return (
          packet !== null ||
          !(yield* inventory.contains(selector, item.quantity))
        );
      });

    const load: ShopsApiShape["load"] = (shopId) =>
      Effect.gen(function* () {
        const id = asPositiveInt(shopId);
        if (id === undefined) {
          return false;
        }

        const info = yield* shops.getInfo;
        if (info !== null && info.id !== id && (yield* isOpen(info.id))) {
          yield* close(info.id);
        }

        yield* bridge.call("shops.load", [id]);
        const packet = yield* protocol.oncePacket(
          { command: "loadShop" },
          { timeout: "5 seconds" },
        );
        return packet !== null;
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
              : { shopItemId: Number(item.shopItemId) };
          return yield* bridge.call("shops.getMaxBuyQuantity", [
            bridgeSelector,
          ]);
        }),
      isMergeShop: bridge.call("shops.isMergeShop"),
      isOpen,
      load,
      loadArmorCustomize: bridge.call("shops.loadArmorCustomize"),
      loadHairShop: (shopId) =>
        asPositiveInt(shopId) === undefined
          ? Effect.void
          : bridge.call("shops.loadHairShop", [Math.trunc(shopId)]),
      sell,
    });
  }),
);
