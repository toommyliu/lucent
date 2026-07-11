import { Effect } from "effect";

import type { Event, RuntimeEvent } from "../contract/Event";
import type { Packet } from "../contract/Packet";
import { projectAuth } from "../projection/Auth";
import { projectCombat } from "../projection/Combat";
import { projectItems } from "../projection/Items";
import { projectQuests } from "../projection/Quests";
import { projectShops } from "../projection/Shops";
import { projectWorld } from "../projection/World";
import type { Store } from "../state/Store";

interface EventSink {
  readonly publishEvent: (event: Event) => Effect.Effect<void>;
}

const itemCommands = new Set([
  "loadInventoryBig",
  "initInventory",
  "loadHouseInventory",
  "loadBank",
  "bankFromInv",
  "bankToInv",
  "dropItem",
  "getDrop",
  "addItems",
  "forceAddItem",
  "removeItem",
  "sellItem",
  "removeTempItem",
]);
const questCommands = new Set(["getQuests", "getQuests2", "ccqr"]);
const worldCommands = new Set([
  "moveToArea",
  "initUserData",
  "uotls",
  "mtls",
  "moveToCell",
  "clearAuras",
]);

export const makePipeline = (store: Store, sink: EventSink) => {
  const publish = (events: readonly Event[]) =>
    Effect.forEach(events, sink.publishEvent, { discard: true });

  return {
    packet: (packet: Packet) => {
      const projected =
        packet.command === "ct" || packet.command === "cb"
          ? projectCombat(store, packet)
          : itemCommands.has(packet.command)
            ? projectItems(store, packet)
            : questCommands.has(packet.command)
              ? projectQuests(store, packet)
              : packet.command === "loadShop"
                ? projectShops(store, packet)
                : worldCommands.has(packet.command)
                  ? projectWorld(store, packet)
                  : Effect.succeed<readonly Event[]>([]);
      return projected.pipe(Effect.flatMap(publish));
    },
    runtime: (event: RuntimeEvent) => projectAuth(store, event),
  };
};

export type Pipeline = ReturnType<typeof makePipeline>;
