import { Effect, Option, Schema } from "effect";
import { LiveItem } from "@lucent/game";

import { WireBoolean, WireInt, PositiveWireInt } from "../contract/Coercion";
import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import { packetData, type Packet } from "../contract/Packet";
import { ItemPayload, ItemPayloads, toItem } from "../contract/payload/Items";
import type { Store } from "../state/Store";

const InventoryLoad = Schema.Struct({
  hitems: Schema.optionalKey(ItemPayloads),
  items: Schema.optionalKey(ItemPayloads),
});
const BankLoad = Schema.Struct({
  bitSuccess: WireBoolean,
  items: ItemPayloads,
});
const ItemMutation = Schema.Struct({
  ItemID: PositiveWireInt,
  bBank: Schema.optionalKey(WireBoolean),
  bHouse: Schema.optionalKey(WireBoolean),
  bSuccess: Schema.optionalKey(WireBoolean),
  iQty: Schema.optionalKey(WireInt),
  iQtyNow: Schema.optionalKey(WireInt),
});
const DropItem = Schema.Struct({
  Item: ItemPayload,
});
const ItemsRecord = Schema.Struct({
  items: Schema.Record(Schema.String, ItemPayload),
});

const decodeInventoryLoad = Schema.decodeUnknownOption(InventoryLoad);
const decodeBankLoad = Schema.decodeUnknownOption(BankLoad);
const decodeItemMutation = Schema.decodeUnknownOption(ItemMutation);
const decodeDropItem = Schema.decodeUnknownOption(DropItem);
const decodeItemsRecord = Schema.decodeUnknownOption(ItemsRecord);

const move = (
  store: Store,
  source: "bank" | "inventory",
  target: "bank" | "inventory",
  itemId: number,
) =>
  Effect.gen(function* () {
    const item = yield* store.items.remove(source, itemId);
    if (item === null) return;
    item.update({ context: target });
    yield* store.items.upsert(target, item);
  });

export const projectItems = (
  store: Store,
  packet: Packet,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    const data = packetData(packet);
    switch (packet.command) {
      case "loadInventoryBig":
      case "initInventory":
      case "loadHouseInventory": {
        const decoded = decodeInventoryLoad(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            `items:${packet.command}`,
            new Error("Malformed container payload"),
            ["[payload omitted]"],
          );
          return [];
        }
        if (decoded.value.items !== undefined) {
          const context =
            packet.command === "loadHouseInventory" ? "house" : "inventory";
          yield* store.items.replace(
            context,
            decoded.value.items.map((item) => toItem(item, { context })),
          );
        }
        if (decoded.value.hitems !== undefined) {
          yield* store.items.replace(
            "house",
            decoded.value.hitems.map((item) =>
              toItem(item, { context: "house" }),
            ),
          );
        }
        return [];
      }
      case "loadBank": {
        const decoded = decodeBankLoad(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            "items:loadBank",
            new Error("Malformed bank payload"),
            ["[payload omitted]"],
          );
        } else if (decoded.value.bitSuccess) {
          yield* store.items.replace(
            "bank",
            decoded.value.items.map((item) =>
              toItem(item, { context: "bank" }),
            ),
          );
        }
        return [];
      }
      case "bankFromInv":
      case "bankToInv": {
        const decoded = decodeItemMutation(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            `items:${packet.command}`,
            new Error("Malformed transfer payload"),
            ["[payload omitted]"],
          );
          return [];
        }
        if (decoded.value.bSuccess === false) return [];
        yield* packet.command === "bankFromInv"
          ? move(store, "inventory", "bank", decoded.value.ItemID)
          : move(store, "bank", "inventory", decoded.value.ItemID);
        return [];
      }
      case "dropItem": {
        const decoded = decodeDropItem(data);
        if (Option.isSome(decoded)) {
          yield* store.items.upsert(
            "drop",
            toItem(decoded.value.Item, { context: "drop" }),
          );
        } else {
          yield* diagnose(
            "items:dropItem",
            new Error("Malformed drop payload"),
            ["[payload omitted]"],
          );
        }
        return [];
      }
      case "getDrop": {
        const decoded = decodeItemMutation(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            "items:getDrop",
            new Error("Malformed drop response"),
            ["[payload omitted]"],
          );
          return [];
        }
        if (decoded.value.bSuccess !== true) return [];
        const drop = yield* store.items.remove("drop", decoded.value.ItemID);
        if (drop === null) return [];
        const context = decoded.value.bBank
          ? "bank"
          : decoded.value.bHouse || drop.houseItem
            ? "house"
            : "inventory";
        const current = yield* store.items.get(context, {
          itemId: decoded.value.ItemID,
        });
        const quantity =
          decoded.value.iQtyNow ??
          (current?.quantity ?? 0) + (decoded.value.iQty ?? drop.quantity);
        const accepted = new LiveItem({
          ...drop.snapshot(),
          context,
          quantity,
        });
        yield* store.items.upsert(context, accepted);
        return [];
      }
      case "addItems":
      case "forceAddItem": {
        const decoded = decodeItemsRecord(data);
        if (Option.isNone(decoded)) return [];
        for (const payload of Object.values(decoded.value.items)) {
          const item = toItem(payload);
          yield* store.items.upsert(
            item.temporaryItem ? "temporary" : "inventory",
            item,
          );
        }
        return [];
      }
      case "removeItem":
      case "sellItem":
      case "removeTempItem": {
        const decoded = decodeItemMutation(data);
        if (Option.isNone(decoded) || decoded.value.bSuccess === false)
          return [];
        const container =
          packet.command === "removeTempItem" ? "temporary" : "inventory";
        const current = yield* store.items.get(container, {
          itemId: decoded.value.ItemID,
        });
        if (current === null) return [];
        const quantity = decoded.value.iQtyNow ?? 0;
        if (quantity <= 0) yield* store.items.remove(container, current.itemId);
        else current.update({ quantity });
        return [];
      }
      default:
        return [];
    }
  });
