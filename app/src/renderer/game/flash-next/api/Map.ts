import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { Store } from "../state/Store";

const Strings = Schema.Array(Schema.String);

export const makeMap = (bridge: BridgeService, store: Store) => ({
  getCellPads: () =>
    bridge
      .invoke("world.getCellPads", undefined, Strings)
      .pipe(Effect.map(Option.getOrElse(() => []))),
  getCells: () =>
    bridge
      .invoke("world.getCells", undefined, Strings)
      .pipe(Effect.map(Option.getOrElse(() => []))),
  getId: () => store.world.getMap.pipe(Effect.map((map) => map.id)),
  getMapItem: (itemId: number) =>
    bridge
      .invoke("world.getMapItem", [itemId], Schema.Void)
      .pipe(Effect.asVoid),
  getName: () => store.world.getMap.pipe(Effect.map((map) => map.name)),
  getRoomNumber: () =>
    store.world.getMap.pipe(Effect.map((map) => map.roomNumber)),
  isLoaded: () =>
    bridge
      .invoke("world.isLoaded", undefined, Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false))),
  loadSwf: (swf: string) =>
    bridge.invoke("world.loadSwf", [swf], Schema.Void).pipe(Effect.asVoid),
  reload: () =>
    bridge.invoke("world.reload", undefined, Schema.Void).pipe(Effect.asVoid),
  setSpawnPoint: (cell?: string, pad?: string) =>
    bridge
      .invoke("world.setSpawnPoint", [cell, pad], Schema.Void)
      .pipe(Effect.asVoid),
});

export type Map = ReturnType<typeof makeMap>;
