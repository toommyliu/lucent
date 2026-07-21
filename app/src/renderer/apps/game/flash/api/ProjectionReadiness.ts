import { Effect } from "effect";

import type { Store } from "../state/Store";

export interface ProjectionReadinessState {
  readonly houseInventory: boolean;
  readonly inventory: boolean;
  readonly map: boolean;
  readonly player: boolean;
}

// These projections use absence as real game state after hydration, so scripts
// must not observe their initial empty stores as authoritative data.
export const makeProjectionReadiness = (store: Store) => {
  const get = Effect.fn("ProjectionReadiness.get")(function* () {
    const state = yield* Effect.all({
      houseInventory: store.items.isHydrated("house"),
      inventory: store.items.isHydrated("inventory"),
      map: store.world.getMap,
      player: store.world.getMe,
    });

    return {
      houseInventory: state.houseInventory,
      inventory: state.inventory,
      map: state.map.name !== "",
      player: state.player !== null,
    } satisfies ProjectionReadinessState;
  });

  const isReady = Effect.fn("ProjectionReadiness.isReady")(function* () {
    const state = yield* get();
    return state.houseInventory && state.inventory && state.map && state.player;
  });

  return { get, isReady };
};

export type ProjectionReadiness = ReturnType<typeof makeProjectionReadiness>;
