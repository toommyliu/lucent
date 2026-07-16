import { Effect } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { Event, RuntimeEvent } from "../contract/Event";
import type { DiagnosticReporter } from "../contract/Diagnostic";
import type { Packet } from "../contract/Packet";
import { projectAuth } from "../projection/Auth";
import { projectCombat } from "../projection/Combat";
import { projectItems } from "../projection/Items";
import { projectQuests } from "../projection/Quests";
import { projectShops } from "../projection/Shops";
import { projectWorld } from "../projection/World";
import type { Store, StoreSnapshot } from "../state/Store";

export interface ProjectionDifference {
  readonly after?: unknown;
  readonly before?: unknown;
}

export interface ProjectionTrace {
  readonly after: StoreSnapshot;
  readonly before: StoreSnapshot;
  readonly changed: boolean;
  readonly diff: Readonly<Record<string, ProjectionDifference>>;
  readonly packet: Packet;
}

interface EventSink {
  readonly publishEvent: (event: Event) => Effect.Effect<void>;
  readonly reportDiagnostic?: DiagnosticReporter;
  readonly reportProjectionTrace?: (
    operation: string,
    trace: ProjectionTrace,
  ) => Effect.Effect<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const stateDiff = (
  before: unknown,
  after: unknown,
  path = "state",
  differences: Record<string, ProjectionDifference> = {},
): Record<string, ProjectionDifference> => {
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
  "turnIn",
  "unequipItem",
  "unwearItem",
  "wearItem",
  "enhanceItemShop",
  "Wheel",
]);
const questCommands = new Set(["getQuests", "getQuests2", "ccqr"]);
const clientWorldCommands = new Set(["moveToCell", "mv"]);
const extensionWorldCommands = new Set([
  "moveToArea",
  "initUserData",
  "initUserDatas",
  "exitArea",
  "uotls",
  "mtls",
  "clearAuras",
  "event",
  "respawnMon",
  "addGoldExp",
  "mtcid",
]);

export const makePipeline = (
  store: Store,
  sink: EventSink,
  bridge?: BridgeService,
) => {
  const diagnose: DiagnosticReporter =
    sink.reportDiagnostic ?? (() => Effect.void);
  const publish = (events: readonly Event[]) =>
    Effect.forEach(events, sink.publishEvent, { discard: true });

  const runProjection = (
    packet: Packet,
    projected: Effect.Effect<readonly Event[]>,
  ) => {
    const reportProjectionTrace = sink.reportProjectionTrace;
    if (reportProjectionTrace === undefined) {
      return projected.pipe(Effect.flatMap(publish));
    }

    return Effect.gen(function* () {
      const before = yield* store.snapshot;
      const events = yield* projected;
      const after = yield* store.snapshot;
      const diff = stateDiff(before, after);
      const changed = Object.keys(diff).length > 0;

      yield* reportProjectionTrace(`projection:${packet.command}`, {
        after,
        before,
        changed,
        diff,
        packet,
      });

      yield* publish(events);
    });
  };

  const projectionFor = (
    packet: Packet,
  ): Effect.Effect<readonly Event[]> | undefined => {
    if (packet.direction === "server") {
      return packet.command === "ct"
        ? projectCombat(store, packet, diagnose)
        : undefined;
    }

    if (packet.direction === "client") {
      return clientWorldCommands.has(packet.command)
        ? projectWorld(store, packet, diagnose, bridge)
        : undefined;
    }

    if (packet.command === "cb") {
      return projectCombat(store, packet, diagnose);
    }
    if (itemCommands.has(packet.command)) {
      return projectItems(store, packet, diagnose);
    }
    if (questCommands.has(packet.command)) {
      return projectQuests(store, packet, diagnose);
    }
    if (packet.command === "loadShop") {
      return projectShops(store, packet, diagnose);
    }
    if (extensionWorldCommands.has(packet.command)) {
      return projectWorld(store, packet, diagnose, bridge);
    }
    return undefined;
  };

  return {
    packet: (packet: Packet) => {
      const projected = projectionFor(packet);
      if (projected === undefined) return Effect.void;
      return runProjection(packet, projected);
    },
    runtime: (event: RuntimeEvent) => projectAuth(store, event),
  };
};

export type Pipeline = ReturnType<typeof makePipeline>;
