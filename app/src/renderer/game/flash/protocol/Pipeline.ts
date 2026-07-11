import { Effect } from "effect";

import type { Event, RuntimeEvent } from "../contract/Event";
import type { DiagnosticReporter } from "../contract/Diagnostic";
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
  readonly reportDiagnostic?: DiagnosticReporter;
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
  "initUserDatas",
  "exitArea",
  "uotls",
  "mtls",
  "moveToCell",
  "clearAuras",
  "event",
  "respawnMon",
  "addGoldExp",
  "mv",
]);

export const makePipeline = (store: Store, sink: EventSink) => {
  const diagnose: DiagnosticReporter =
    sink.reportDiagnostic ?? (() => Effect.void);
  const publish = (events: readonly Event[]) =>
    Effect.forEach(events, sink.publishEvent, { discard: true });

  return {
    packet: (packet: Packet) => {
      const projected =
        packet.command === "ct" || packet.command === "cb"
          ? projectCombat(store, packet, diagnose)
          : itemCommands.has(packet.command)
            ? projectItems(store, packet, diagnose)
            : questCommands.has(packet.command)
              ? projectQuests(store, packet, diagnose)
              : packet.command === "loadShop"
                ? projectShops(store, packet, diagnose)
                : worldCommands.has(packet.command)
                  ? projectWorld(store, packet, diagnose)
                  : Effect.succeed<readonly Event[]>([]);
      return projected.pipe(Effect.flatMap(publish));
    },
    runtime: (event: RuntimeEvent) => projectAuth(store, event),
  };
};

export type Pipeline = ReturnType<typeof makePipeline>;
