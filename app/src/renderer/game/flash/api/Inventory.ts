import { normalizeItemQuantity, toItemSelector } from "@lucent/game";
import type { ItemQuery } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { ItemPayload, ItemPayloads, toItem } from "../contract/payload/Items";
import { WireInt } from "../contract/Coercion";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

const NullableItem = Schema.NullOr(ItemPayload);

export const makeInventory = (
  bridge: BridgeService,
  store: Store,
  wait: Wait,
) => {
  const getAll = () =>
    bridge.invoke("inventory.getItems", undefined, ItemPayloads).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => store.items.getAll("inventory"),
          onSome: (payloads) => {
            const items = payloads.map((payload) =>
              toItem(payload, { context: "inventory" }),
            );
            return store.items
              .replace("inventory", items)
              .pipe(Effect.as(items));
          },
        }),
      ),
    );
  const get = (selector: ItemQuery) => {
    return store.items.get("inventory", selector).pipe(
      Effect.flatMap((cached) =>
        cached !== null
          ? Effect.succeed(cached)
          : bridge
              .invoke(
                "inventory.getItem",
                [toItemSelector(selector)],
                NullableItem,
              )
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.succeed(null),
                    onSome: (payload) => {
                      if (payload === null) return Effect.succeed(null);
                      const item = toItem(payload, { context: "inventory" });
                      return store.items
                        .upsert("inventory", item)
                        .pipe(Effect.map((stored) => stored));
                    },
                  }),
                ),
              ),
      ),
    );
  };
  const getSlots = () =>
    bridge
      .invoke("inventory.getSlots", undefined, WireInt)
      .pipe(Effect.map(Option.getOrElse(() => 0)));
  const getUsedSlots = () =>
    store.items.getAll("inventory").pipe(Effect.map((items) => items.length));

  const contains = (selector: ItemQuery, requested?: number) =>
    get(selector).pipe(
      Effect.map(
        (item) =>
          item !== null && item.quantity >= normalizeItemQuantity(requested),
      ),
    );

  const equip = (selector: ItemQuery) => {
    return get(selector).pipe(
      Effect.flatMap((item) => {
        if (item === null) return Effect.succeed(false);
        if (item.equipped) return Effect.succeed(true);
        return wait.forGameAction("equipItem").pipe(
          Effect.flatMap((ready) =>
            ready
              ? bridge.invoke(
                  "inventory.equip",
                  [{ itemId: item.itemId }],
                  Schema.Boolean,
                )
              : Effect.succeed(Option.none()),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (sent) =>
                sent
                  ? wait.until(
                      get(item.itemId).pipe(
                        Effect.map((current) => current?.equipped === true),
                      ),
                      { timeout: "5 seconds" },
                    )
                  : Effect.succeed(false),
            }),
          ),
        );
      }),
    );
  };

  const getAvailableSlots = () =>
    Effect.zipWith(getSlots(), getUsedSlots(), (slots, used) =>
      Math.max(0, slots - used),
    );

  const unequipConsumable = (selector: ItemQuery) => {
    return get(selector).pipe(
      Effect.flatMap((item) => {
        if (item === null || item.category !== "Item") {
          return Effect.succeed(false);
        }
        if (!item.equipped) return Effect.succeed(true);
        return wait.forGameAction("unequipItem").pipe(
          Effect.flatMap((ready) =>
            ready
              ? bridge.invoke(
                  "inventory.unequipConsumable",
                  [{ itemId: item.itemId }],
                  Schema.Boolean,
                )
              : Effect.succeed(Option.none()),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (sent) =>
                sent
                  ? wait.until(
                      get(item.itemId).pipe(
                        Effect.map(
                          (current) =>
                            current !== null && current.equipped !== true,
                        ),
                      ),
                      { timeout: "5 seconds" },
                    )
                  : Effect.succeed(false),
            }),
          ),
        );
      }),
    );
  };

  return {
    contains,
    equip,
    get,
    getAll,
    getAvailableSlots,
    getSlots,
    getUsedSlots,
    unequipConsumable,
  };
};

export type Inventory = ReturnType<typeof makeInventory>;
