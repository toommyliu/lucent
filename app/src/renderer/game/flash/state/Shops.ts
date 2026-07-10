import { Context, Effect, Layer, SynchronizedRef } from "effect";

import type { Item, Shop, ShopItemSelector } from "../Types";
import { LiveItem, LiveShop } from "@lucent/game";
import { decodeShop } from "../payload";
import {
  normalizeShopItemSelector,
  shopItemMatchesSelector,
} from "../selectors";

interface ShopsRuntimeState {
  info: LiveShop | null;
}

export interface ShopsStateShape {
  readonly clear: () => Effect.Effect<void>;
  readonly findByItemId: (itemId: number) => Effect.Effect<Item | null>;
  readonly getAll: () => Effect.Effect<readonly Item[]>;
  readonly getInfo: () => Effect.Effect<Shop | null>;
  readonly getOne: (selector: ShopItemSelector) => Effect.Effect<Item | null>;
  readonly setInfo: (value: unknown) => Effect.Effect<void>;
}

export class ShopsState extends Context.Service<ShopsState, ShopsStateShape>()(
  "lucent/game/flash/state/Shops",
) {}

export const layer = Layer.effect(
  ShopsState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make<ShopsRuntimeState>({ info: null });

    return ShopsState.of({
      clear: () =>
        SynchronizedRef.update(ref, (state) => {
          state.info = null;
          return state;
        }),
      findByItemId: (itemId) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map(
            (state) =>
              state.info?.items.find((item) => item.itemId === itemId) ?? null,
          ),
        ),
      getAll: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => state.info?.items ?? []),
        ),
      getInfo: () =>
        SynchronizedRef.get(ref).pipe(Effect.map((state) => state.info)),
      getOne: (selector) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => {
            const normalized = normalizeShopItemSelector(selector);
            if (state.info === null || normalized === null) {
              return null;
            }

            const matches = state.info.items.filter((item) =>
              shopItemMatchesSelector(item, normalized),
            );
            if (matches.length > 1) {
              console.warn("[flash:shops]", "ambiguous shop item selector", {
                matches: matches.map((item) => ({ ...item })),
                selector,
              });
              return null;
            }

            return matches[0] ?? null;
          }),
        ),
      setInfo: (value) =>
        SynchronizedRef.update(ref, (state) => {
          const info = decodeShop(value);
          if (info !== null) {
            if (state.info === null || state.info.id !== info.id) {
              state.info = info;
            } else {
              const existing = new Map(
                state.info.items.map((item) => [
                  item.shopItemId ?? item.itemId,
                  item as LiveItem,
                ]),
              );
              const items = info.items.map((item) => {
                const incoming = item as LiveItem;
                const current = existing.get(item.shopItemId ?? item.itemId);
                if (current === undefined) return incoming;
                current.replaceFrom(incoming);
                return current;
              });
              state.info.update({ ...info.snapshot(), items });
            }
          }
          return state;
        }),
    });
  }),
);
