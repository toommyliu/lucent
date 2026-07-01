import { Context, Effect, Layer } from "effect";

import type { ItemRecord, ItemSelector } from "../Types";
import { ItemsState } from "../state/Items";

export interface TempInventoryApiShape {
  readonly contains: (
    selector: ItemSelector,
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly get: (selector: ItemSelector) => Effect.Effect<ItemRecord | null>;
  readonly getAll: Effect.Effect<readonly ItemRecord[]>;
}

export class TempInventoryApi extends Context.Service<
  TempInventoryApi,
  TempInventoryApiShape
>()("lucent/game/flash/api/TempInventory") {}

export const layer = Layer.effect(
  TempInventoryApi,
  Effect.gen(function* () {
    const items = yield* ItemsState;

    return TempInventoryApi.of({
      contains: (selector, quantity) =>
        items.contains("temp", selector, quantity),
      get: (selector) => items.get("temp", selector),
      getAll: items.getAll("temp"),
    });
  }),
);
