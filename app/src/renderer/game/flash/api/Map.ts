import { Context, Effect, Layer } from "effect";

import type { MapRecord } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { WorldState } from "../state/World";
import { WaitApi } from "./Wait";

export interface MapApiShape {
  readonly getCellPads: () => Effect.Effect<readonly string[]>;
  readonly getCells: () => Effect.Effect<readonly string[]>;
  readonly getId: () => Effect.Effect<number>;
  readonly getMapItem: (itemId: number) => Effect.Effect<void>;
  readonly getName: () => Effect.Effect<string>;
  readonly getRoomNumber: () => Effect.Effect<number>;
  readonly isLoaded: () => Effect.Effect<boolean>;
  readonly loadSwf: (swf: string) => Effect.Effect<void>;
  readonly reload: () => Effect.Effect<void>;
  readonly setSpawnPoint: (cell?: string, pad?: string) => Effect.Effect<void>;
}

export class MapApi extends Context.Service<MapApi, MapApiShape>()(
  "lucent/game/flash/api/Map",
) {}

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

export const layer = Layer.effect(
  MapApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const wait = yield* WaitApi;
    const world = yield* WorldState;

    const getMap = world.getMap();
    const project = <A>(f: (map: MapRecord) => A) => getMap.pipe(Effect.map(f));

    return MapApi.of({
      getCellPads: () =>
        bridge.call("world.getCellPads").pipe(Effect.map(stringArray)),
      getCells: () =>
        bridge.call("world.getCells").pipe(Effect.map(stringArray)),
      getId: () => project((map) => map.id),
      getMapItem: (itemId) =>
        Effect.gen(function* () {
          const available = yield* wait.forGameAction("getMapItem");
          if (available && Number.isFinite(itemId) && itemId > 0) {
            yield* bridge.call("world.getMapItem", [Math.trunc(itemId)]);
          }
        }),
      getName: () => project((map) => map.name),
      getRoomNumber: () => project((map) => map.roomNumber),
      isLoaded: () => bridge.call("world.isLoaded"),
      loadSwf: (swf) => bridge.call("world.loadSwf", [swf]),
      reload: () => bridge.call("world.reload"),
      setSpawnPoint: (cell, pad) =>
        cell === undefined && pad === undefined
          ? bridge.call("world.setSpawnPoint")
          : pad === undefined
            ? bridge.call("world.setSpawnPoint", [cell])
            : bridge.call("world.setSpawnPoint", [cell, pad]),
    });
  }),
);
