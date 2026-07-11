import { Effect, Option } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { WireInt } from "../contract/Coercion";
import { ItemPayloads, toItem } from "../contract/payload/Items";
import { decodeItemSelector } from "../domain/Selectors";
import type { Store } from "../state/Store";

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

  return {
    get: (selector: unknown) => {
      const decoded = decodeItemSelector(selector);
      return Option.isNone(decoded)
        ? Effect.succeed(null)
        : store.items.get("house", decoded.value);
    },
    getAll,
    getAvailableSlots: () =>
      Effect.zipWith(getSlots(), getUsedSlots(), (slots, used) =>
        Math.max(0, slots - used),
      ),
    getSlots,
    getUsedSlots,
  };
};

export type House = ReturnType<typeof makeHouse>;
