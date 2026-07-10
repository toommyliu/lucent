import { Context, Effect, Layer, SynchronizedRef } from "effect";

import type { Item, ItemSelector } from "../Types";
import { itemMatchesSelector, normalizeItemSelector } from "../selectors";

interface DropsRuntimeState {
  readonly drops: Map<number, Item>;
}

export interface DropsStateShape {
  readonly clear: () => Effect.Effect<void>;
  readonly contains: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly get: (selector: ItemSelector) => Effect.Effect<Item | null>;
  readonly getAll: () => Effect.Effect<readonly Item[]>;
  readonly remove: (itemId: number) => Effect.Effect<void>;
  readonly replace: (drops: readonly Item[]) => Effect.Effect<void>;
  readonly upsert: (drop: Item) => Effect.Effect<void>;
}

export class DropsState extends Context.Service<DropsState, DropsStateShape>()(
  "lucent/game/flash/state/Drops",
) {}

export const layer = Layer.effect(
  DropsState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make<DropsRuntimeState>({
      drops: new Map(),
    });

    const get: DropsStateShape["get"] = (selector) =>
      SynchronizedRef.get(ref).pipe(
        Effect.map((state) => {
          const normalized = normalizeItemSelector(selector);
          if (normalized === null) {
            return null;
          }

          return (
            Array.from(state.drops.values()).find((drop) =>
              itemMatchesSelector(drop, normalized),
            ) ?? null
          );
        }),
      );

    return DropsState.of({
      clear: () =>
        SynchronizedRef.update(ref, (state) => {
          state.drops.clear();
          return state;
        }),
      contains: (selector) =>
        get(selector).pipe(Effect.map((drop) => drop !== null)),
      get,
      getAll: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => Array.from(state.drops.values())),
        ),
      remove: (itemId) =>
        SynchronizedRef.update(ref, (state) => {
          state.drops.delete(itemId);
          return state;
        }),
      replace: (drops) =>
        SynchronizedRef.update(ref, (state) => {
          const incoming = new Set(drops.map((drop) => drop.itemId));
          for (const itemId of state.drops.keys())
            if (!incoming.has(itemId)) state.drops.delete(itemId);
          for (const drop of drops) {
            state.drops.set(drop.itemId, drop);
          }
          return state;
        }),
      upsert: (drop) =>
        SynchronizedRef.update(ref, (state) => {
          state.drops.set(drop.itemId, drop);
          return state;
        }),
    });
  }),
);
