import type { ItemQuery } from "@lucent/game";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { BridgeService } from "../bridge/Bridge";
import { WireInt } from "../contract/Coercion";
import type { Store } from "../state/Store";

export const makeHouse = (bridge: BridgeService, store: Store) => {
  const getAll = () => store.items.getAll("house");

  const getSlots = () =>
    bridge
      .invoke("house.getSlots", undefined, WireInt)
      .pipe(Effect.map(Option.getOrElse(() => 0)));

  const getUsedSlots = () =>
    store.items.getAll("house").pipe(Effect.map((items) => items.length));

  const get = (selector: ItemQuery) => store.items.get("house", selector);

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
