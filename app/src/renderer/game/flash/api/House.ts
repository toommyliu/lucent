import { toItemSelector } from "@lucent/game";
import type { ItemQuery } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { WireInt } from "../contract/Coercion";
import { ItemPayload, ItemPayloads, toItem } from "../contract/payload/Items";
import type { Store } from "../state/Store";

const NullableItem = Schema.NullOr(ItemPayload);

export const makeHouse = (bridge: BridgeService, store: Store) => {
  const getAll = () =>
    bridge.invoke("house.getItems", undefined, ItemPayloads).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => store.items.getAll("house"),
          onSome: (payloads) => {
            const items = payloads.map((payload) =>
              toItem(payload, { context: "house" }),
            );
            return store.items.replace("house", items).pipe(Effect.as(items));
          },
        }),
      ),
    );
  const getSlots = () =>
    bridge
      .invoke("house.getSlots", undefined, WireInt)
      .pipe(Effect.map(Option.getOrElse(() => 0)));
  const getUsedSlots = () =>
    store.items.getAll("house").pipe(Effect.map((items) => items.length));

  const get = (selector: ItemQuery) => {
    return store.items.get("house", selector).pipe(
      Effect.flatMap((cached) =>
        cached !== null
          ? Effect.succeed(cached)
          : bridge
              .invoke("house.getItem", [toItemSelector(selector)], NullableItem)
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.succeed(null),
                    onSome: (payload) =>
                      payload === null
                        ? Effect.succeed(null)
                        : store.items.upsert(
                            "house",
                            toItem(payload, { context: "house" }),
                          ),
                  }),
                ),
              ),
      ),
    );
  };

  const getAvailableSlots = () =>
    Effect.zipWith(getSlots(), getUsedSlots(), (slots, used) =>
      Math.max(0, slots - used),
    );

  return {
    get,
    getAll,
    getAvailableSlots,
    getSlots,
    getUsedSlots,
  };
};

export type House = ReturnType<typeof makeHouse>;
