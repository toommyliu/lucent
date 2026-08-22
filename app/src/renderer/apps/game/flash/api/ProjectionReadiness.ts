import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { projectionKeys, type ProjectionKey } from "../state/Projection";
import type { Store } from "../state/Store";

export interface ProjectionReadinessState {
  readonly houseInventory: boolean;
  readonly inventory: boolean;
  readonly map: boolean;
  readonly player: boolean;
}

export interface ProjectionReadinessSnapshot {
  readonly epoch: number;
  readonly failures: Partial<Record<ProjectionKey, string>>;
  readonly missing: readonly ProjectionKey[];
  readonly state: ProjectionReadinessState;
}

// These projections use absence as real game state after hydration, so scripts
// must not observe their initial empty stores as authoritative data.
export const makeProjectionReadiness = (store: Store) => {
  const inspect = Effect.fn("ProjectionReadiness.inspect")(function* () {
    const projected = yield* Effect.all({
      houseInventory: store.items.isHydrated("house"),
      inventory: store.items.isHydrated("inventory"),
      map: store.world.getMap,
      player: store.world.getMe,
      projection: store.projection.get,
    });

    const state = {
      houseInventory:
        projected.projection.completed.houseInventory &&
        projected.houseInventory,
      inventory:
        projected.projection.completed.inventory && projected.inventory,
      map: projected.projection.completed.map && projected.map.name !== "",
      player:
        projected.projection.completed.player && projected.player !== null,
    } satisfies ProjectionReadinessState;

    return {
      epoch: projected.projection.epoch,
      failures: projected.projection.failures,
      missing: projectionKeys.filter((key) => !state[key]),
      state,
    } satisfies ProjectionReadinessSnapshot;
  });

  const get = Effect.fn("ProjectionReadiness.get")(function* () {
    return (yield* inspect()).state;
  });

  const isReady = Effect.fn("ProjectionReadiness.isReady")(function* () {
    return (yield* inspect()).missing.length === 0;
  });

  return { get, inspect, isReady };
};

export class ProjectionReadiness extends Context.Service<
  ProjectionReadiness,
  ReturnType<typeof makeProjectionReadiness>
>()("lucent/renderer/flash/ProjectionReadiness") {}
