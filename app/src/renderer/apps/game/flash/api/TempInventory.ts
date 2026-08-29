import { normalizeItemQuantity } from "@lucent/game";
import type { ItemQuery } from "@lucent/game";
import * as Effect from "effect/Effect";

import type { Store } from "../state/Store";

export const makeTempInventory = (store: Store) => {
  const contains = (selector: ItemQuery, quantity?: number) => {
    return store.items
      .quantity("temporary", selector)
      .pipe(Effect.map((owned) => owned >= normalizeItemQuantity(quantity)));
  };

  const get = (selector: ItemQuery) => store.items.get("temporary", selector);

  const getAll = () => store.items.getAll("temporary");

  return {
    contains,
    get,
    getAll,
  };
};

export type TempInventory = ReturnType<typeof makeTempInventory>;
