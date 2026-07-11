import { Effect, Option } from "effect";

import { decodeItemSelector, quantity } from "../domain/Selectors";
import type { Store } from "../state/Store";

export const makeTempInventory = (store: Store) => {
  const contains = (selector: unknown, requested?: number) => {
    const decoded = decodeItemSelector(selector);
    return Option.isNone(decoded)
      ? Effect.succeed(false)
      : store.items
          .quantity("temporary", decoded.value)
          .pipe(Effect.map((owned) => owned >= quantity(requested)));
  };

  const get = (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    return Option.isNone(decoded)
      ? Effect.succeed(null)
      : store.items.get("temporary", decoded.value);
  };

  const getAll = () => store.items.getAll("temporary");

  return {
    contains,
    get,
    getAll,
  };
};

export type TempInventory = ReturnType<typeof makeTempInventory>;
