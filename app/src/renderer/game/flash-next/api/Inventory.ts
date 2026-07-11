import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { ItemPayload, ItemPayloads, toItem } from "../contract/payload/Items";
import { WireInt } from "../contract/Coercion";
import { decodeItemSelector, quantity } from "../domain/Selectors";
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
  const get = (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(null);
    return store.items.get("inventory", decoded.value).pipe(
      Effect.flatMap((cached) =>
        cached !== null
          ? Effect.succeed(cached)
          : bridge
              .invoke("inventory.getItem", [decoded.value], NullableItem)
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

  return {
    contains: (selector: unknown, requested?: number) =>
      get(selector).pipe(
        Effect.map(
          (item) => item !== null && item.quantity >= quantity(requested),
        ),
      ),
    equip: (selector: unknown) => {
      const decoded = decodeItemSelector(selector);
      if (Option.isNone(decoded)) return Effect.succeed(false);
      return bridge
        .invoke("inventory.equip", [decoded.value], Schema.Boolean)
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (sent) =>
                sent
                  ? wait.until(
                      get(decoded.value).pipe(
                        Effect.map((item) => item?.equipped === true),
                      ),
                      { timeout: "5 seconds" },
                    )
                  : Effect.succeed(false),
            }),
          ),
        );
    },
    get,
    getAll,
    getAvailableSlots: () =>
      Effect.zipWith(getSlots(), getUsedSlots(), (slots, used) =>
        Math.max(0, slots - used),
      ),
    getSlots,
    getUsedSlots,
    unequipConsumable: (selector: unknown) => {
      const decoded = decodeItemSelector(selector);
      return Option.isNone(decoded)
        ? Effect.succeed(false)
        : bridge
            .invoke(
              "inventory.unequipConsumable",
              [decoded.value],
              Schema.Boolean,
            )
            .pipe(Effect.map(Option.getOrElse(() => false)));
    },
  };
};

export type Inventory = ReturnType<typeof makeInventory>;
