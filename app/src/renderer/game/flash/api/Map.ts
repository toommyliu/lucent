import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { Store } from "../state/Store";
import { PositiveWireInt } from "../contract/Coercion";
import type { Wait } from "./Wait";

const Strings = Schema.Array(Schema.String);

const decodeItemId = Schema.decodeUnknownOption(PositiveWireInt);

export const makeMap = (bridge: BridgeService, store: Store, wait: Wait) => {
  const getCellPads = () =>
    bridge.invoke("world.getCellPads", undefined, Strings).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => store.world.getCellPads,
          onSome: (cellPads) =>
            store.world.setCellPads(cellPads).pipe(Effect.as(cellPads)),
        }),
      ),
    );
  const getCells = () =>
    bridge.invoke("world.getCells", undefined, Strings).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => store.world.getCells,
          onSome: (cells) => store.world.setCells(cells).pipe(Effect.as(cells)),
        }),
      ),
    );
  const getId = () => store.world.getMap.pipe(Effect.map((map) => map.id));

  const getMapItem = (input: unknown) => {
    const itemId = decodeItemId(input);
    if (Option.isNone(itemId)) return Effect.void;
    return wait.forGameAction("getMapItem").pipe(
      Effect.flatMap((ready) =>
        ready
          ? bridge.invoke("world.getMapItem", [itemId.value], Schema.Void)
          : Effect.succeed(Option.none()),
      ),
      Effect.asVoid,
    );
  };
  const getName = () => store.world.getMap.pipe(Effect.map((map) => map.name));

  const getRoomNumber = () =>
    store.world.getMap.pipe(Effect.map((map) => map.roomNumber));

  const isLoaded = () =>
    bridge
      .invoke("world.isLoaded", undefined, Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  const loadSwf = (swf: string) =>
    bridge.invoke("world.loadSwf", [swf], Schema.Void).pipe(Effect.asVoid);
  const reload = () =>
    bridge.invoke("world.reload", undefined, Schema.Void).pipe(Effect.asVoid);
  const setSpawnPoint = (cell?: string, pad?: string) =>
    bridge
      .invoke("world.setSpawnPoint", [cell, pad], Schema.Void)
      .pipe(Effect.asVoid);

  return {
    getCellPads,
    getCells,
    getId,
    getMapItem,
    getName,
    getRoomNumber,
    isLoaded,
    loadSwf,
    reload,
    setSpawnPoint,
  };
};

export type Map = ReturnType<typeof makeMap>;
