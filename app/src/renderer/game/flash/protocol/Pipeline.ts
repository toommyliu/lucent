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
  readonly reportProjectionTrace?: (
    operation: string,
    trace: unknown,
  ) => Effect.Effect<void>;
}

interface Difference {
  readonly after?: unknown;
  readonly before?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const stateDiff = (
  before: unknown,
  after: unknown,
  path = "state",
  differences: Record<string, Difference> = {},
): Record<string, Difference> => {
  if (Object.is(before, after)) return differences;

  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      stateDiff(before[key], after[key], `${path}.${key}`, differences);
    }
    return differences;
  }

  differences[path] = {
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
  return differences;
};

const itemCommands = new Set([
  "loadInventoryBig",
  "initInventory",
  "loadHouseInventory",
  "bankFromInv",
  "bankToInv",
  "bankSwapInv",
  "dropItem",
  "equipItem",
  "getDrop",
  "addItems",
  "forceAddItem",
  "removeItem",
  "sellItem",
  "removeTempItem",
  "unequipItem",
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

  const runProjection = (
    packet: Packet,
    projected: Effect.Effect<readonly Event[]>,
  ) => {
    if (sink.reportProjectionTrace === undefined) {
      return projected.pipe(Effect.flatMap(publish));
    }

    return Effect.gen(function* () {
      const before = yield* store.snapshot;
      const events = yield* projected;
      const after = yield* store.snapshot;
      const diff = stateDiff(before, after);

      if (Object.keys(diff).length > 0) {
        yield* sink.reportProjectionTrace!(`projection:${packet.command}`, {
          after,
          before,
          diff,
          packet,
        });
      }

      yield* publish(events);
    });
  };

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
      return runProjection(packet, projected);
    },
    runtime: (event: RuntimeEvent) => projectAuth(store, event),
  };
};

export type Pipeline = ReturnType<typeof makePipeline>;
