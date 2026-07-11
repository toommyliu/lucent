import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireInt } from "../contract/Coercion";
import {
  decodeItemSelector,
  decodeShopSelector,
  quantity,
} from "../domain/Selectors";
import type { Store } from "../state/Store";
import type { Inventory } from "./Inventory";
import type { Wait } from "./Wait";

const decodeShopId = Schema.decodeUnknownOption(PositiveWireInt);

export const makeShops = (
  bridge: BridgeService,
  store: Store,
  inventory: Inventory,
  wait: Wait,
) => {
  const get = (selector: unknown) => {
    const decoded = decodeShopSelector(selector);
    return Option.isNone(decoded)
      ? Effect.succeed(null)
      : store.items.get("shop", decoded.value);
  };
  const isOpen = (input?: unknown) => {
    if (input === undefined) {
      return store.shops.get.pipe(Effect.map((shop) => shop !== null));
    }
    const shopId = decodeShopId(input);
    return Option.isNone(shopId)
      ? Effect.succeed(false)
      : store.shops.get.pipe(Effect.map((shop) => shop?.id === shopId.value));
  };
  const load = (input: unknown) => {
    const shopId = decodeShopId(input);
    if (Option.isNone(shopId)) return Effect.succeed(false);
    return isOpen(shopId.value).pipe(
      Effect.flatMap((open) =>
        open
          ? Effect.succeed(true)
          : wait
              .forPacket(
                { command: "loadShop", direction: "extension" },
                {
                  timeout: "10 seconds",
                  trigger: bridge.invoke(
                    "shops.load",
                    [shopId.value],
                    Schema.Void,
                  ),
                },
              )
              .pipe(Effect.andThen(isOpen(shopId.value))),
      ),
    );
  };

  return {
    buy: (selector: unknown, options?: { quantity?: number }) => {
      const decoded = decodeShopSelector(selector);
      if (Option.isNone(decoded)) return Effect.succeed(false);
      const requested = quantity(options?.quantity);
      return get(decoded.value).pipe(
        Effect.flatMap((item) => {
          if (item === null) return Effect.succeed(false);
          const before = inventory
            .get(item.itemId)
            .pipe(Effect.map((owned) => owned?.quantity ?? 0));
          return Effect.all([before, inventory.getAvailableSlots()]).pipe(
            Effect.flatMap(([existing, slots]) =>
              existing === 0 && slots === 0
                ? Effect.succeed(false)
                : bridge
                    .invoke(
                      "shops.canBuyItem",
                      [decoded.value, requested],
                      Schema.Boolean,
                    )
                    .pipe(
                      Effect.flatMap(
                        Option.match({
                          onNone: () => Effect.succeed(false),
                          onSome: (canBuy) =>
                            canBuy
                              ? bridge
                                  .invoke(
                                    "shops.buy",
                                    [decoded.value, requested],
                                    Schema.Void,
                                  )
                                  .pipe(
                                    Effect.flatMap(
                                      Option.match({
                                        onNone: () => Effect.succeed(false),
                                        onSome: () =>
                                          wait.until(
                                            inventory
                                              .get(item.itemId)
                                              .pipe(
                                                Effect.map(
                                                  (owned) =>
                                                    (owned?.quantity ?? 0) >=
                                                    existing + requested,
                                                ),
                                              ),
                                            { timeout: "10 seconds" },
                                          ),
                                      }),
                                    ),
                                  )
                              : Effect.succeed(false),
                        }),
                      ),
                    ),
            ),
          );
        }),
      );
    },
    canBuy: (selector: unknown, options?: { quantity?: number }) => {
      const decoded = decodeShopSelector(selector);
      return Option.isNone(decoded)
        ? Effect.succeed(false)
        : bridge
            .invoke(
              "shops.canBuyItem",
              [decoded.value, quantity(options?.quantity)],
              Schema.Boolean,
            )
            .pipe(Effect.map(Option.getOrElse(() => false)));
    },
    close: (input?: unknown) => {
      const shopId = input === undefined ? Option.none() : decodeShopId(input);
      if (input !== undefined && Option.isNone(shopId)) {
        return Effect.succeed(false);
      }
      return bridge
        .invoke(
          "shops.close",
          Option.isSome(shopId) ? [shopId.value] : undefined,
          Schema.Boolean,
        )
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (closed) =>
                closed
                  ? store.shops
                      .set(null)
                      .pipe(
                        Effect.andThen(store.items.replace("shop", [])),
                        Effect.as(true),
                      )
                  : Effect.succeed(false),
            }),
          ),
        );
    },
    get,
    getAll: () => store.items.getAll("shop"),
    getInfo: () => store.shops.get,
    getMaxBuyQuantity: (selector: unknown) => {
      const decoded = decodeShopSelector(selector);
      return Option.isNone(decoded)
        ? Effect.succeed(0)
        : bridge
            .invoke("shops.getMaxBuyQuantity", [decoded.value], WireInt)
            .pipe(Effect.map(Option.getOrElse(() => 0)));
    },
    isMergeShop: () =>
      store.shops.get.pipe(Effect.map((shop) => shop?.merge ?? false)),
    isOpen,
    load,
    loadArmorCustomize: () =>
      bridge
        .invoke("shops.loadArmorCustomize", undefined, Schema.Void)
        .pipe(Effect.asVoid),
    loadHairShop: (input: unknown) => {
      const shopId = decodeShopId(input);
      return Option.isNone(shopId)
        ? Effect.void
        : bridge
            .invoke("shops.loadHairShop", [shopId.value], Schema.Void)
            .pipe(Effect.asVoid);
    },
    sell: (selector: unknown, options?: { quantity?: number }) => {
      const decoded = decodeItemSelector(selector);
      if (Option.isNone(decoded)) return Effect.succeed(false);
      const requested = quantity(options?.quantity);
      return inventory.get(decoded.value).pipe(
        Effect.flatMap((item) =>
          item === null || item.quantity < requested
            ? Effect.succeed(false)
            : bridge
                .invoke(
                  "shops.sell",
                  [decoded.value, requested],
                  Schema.Boolean,
                )
                .pipe(
                  Effect.flatMap(
                    Option.match({
                      onNone: () => Effect.succeed(false),
                      onSome: (sold) =>
                        sold
                          ? wait.until(
                              inventory
                                .get(decoded.value)
                                .pipe(
                                  Effect.map(
                                    (current) =>
                                      (current?.quantity ?? 0) <=
                                      item.quantity - requested,
                                  ),
                                ),
                              { timeout: "10 seconds" },
                            )
                          : Effect.succeed(false),
                    }),
                  ),
                ),
        ),
      );
    },
  };
};

export type Shops = ReturnType<typeof makeShops>;
