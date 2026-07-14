import { Effect, Option, Schema } from "effect";
import { LiveItem } from "@lucent/game";

import { WireBoolean, WireInt, PositiveWireInt } from "../contract/Coercion";
import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import { packetData, type Packet } from "../contract/Packet";
import { ItemPayload, toItem } from "../contract/payload/Items";
import type { ItemContainer } from "../state/Items";
import type { Store } from "../state/Store";

const InventoryLoad = Schema.Struct({
  bitSuccess: Schema.optionalKey(WireBoolean),
  hitems: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  items: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const ItemMutation = Schema.Struct({
  ItemID: PositiveWireInt,
  bBank: Schema.optionalKey(WireBoolean),
  bHouse: Schema.optionalKey(WireBoolean),
  bSuccess: Schema.optionalKey(WireBoolean),
  iQty: Schema.optionalKey(WireInt),
  iQtyNow: Schema.optionalKey(WireInt),
});
const BankSwap = Schema.Struct({
  bankItemID: PositiveWireInt,
  invItemID: PositiveWireInt,
});
const ItemsRecord = Schema.Struct({
  items: Schema.Record(Schema.String, Schema.Unknown),
});
const CharacterItemMutation = Schema.Struct({
  CharItemID: PositiveWireInt,
  bBank: Schema.optionalKey(WireBoolean),
  bSuccess: Schema.optionalKey(WireBoolean),
  iQty: Schema.optionalKey(WireInt),
  iQtyNow: Schema.optionalKey(WireInt),
});
const EquipmentMutation = Schema.Struct({
  ItemID: PositiveWireInt,
  success: Schema.optionalKey(WireBoolean),
  strES: Schema.optionalKey(Schema.String),
  uid: Schema.optionalKey(PositiveWireInt),
});
const QuestTurnIn = Schema.Struct({
  sItems: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const decodeInventoryLoad = Schema.decodeUnknownOption(InventoryLoad);
const decodeItemMutation = Schema.decodeUnknownOption(ItemMutation);
const decodeBankSwap = Schema.decodeUnknownOption(BankSwap);
const decodeItemsRecord = Schema.decodeUnknownOption(ItemsRecord);
const decodeCharacterItemMutation = Schema.decodeUnknownOption(
  CharacterItemMutation,
);
const decodeEquipmentMutation = Schema.decodeUnknownOption(EquipmentMutation);
const decodeQuestTurnIn = Schema.decodeUnknownOption(QuestTurnIn);
const decodeItem = Schema.decodeUnknownOption(ItemPayload);

interface TurnInItem {
  readonly itemId: number;
  readonly quantity: number;
}

const parseTurnInItems = (
  value: string,
): {
  readonly invalid: readonly string[];
  readonly items: readonly TurnInItem[];
} => {
  const invalid: string[] = [];
  const items: TurnInItem[] = [];

  for (const entry of value.split(",")) {
    if (entry.trim() === "") continue;
    const parts = entry.split(":");
    const itemId = Number(parts[0]);
    const quantity = Number(parts[1]);
    if (
      parts.length !== 2 ||
      !Number.isSafeInteger(itemId) ||
      itemId <= 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      invalid.push(entry);
      continue;
    }
    items.push({ itemId, quantity });
  }

  return { invalid, items };
};

const decodeContainerItems = (
  values: readonly unknown[],
  context: ItemContainer,
  operation: string,
  diagnose: DiagnosticReporter,
) =>
  Effect.gen(function* () {
    const items: LiveItem[] = [];
    const invalid: unknown[] = [];

    for (const value of values) {
      const decoded = decodeItem(value);
      if (Option.isNone(decoded)) {
        invalid.push(value);
      } else {
        items.push(toItem(decoded.value, { context }));
      }
    }

    if (invalid.length > 0) {
      yield* diagnose(
        operation,
        new Error(`Ignored ${invalid.length} malformed item entries`),
        invalid,
      );
    }

    return items;
  });

const deposit = (store: Store, itemId: number) =>
  Effect.gen(function* () {
    const inventory = yield* store.items.remove("inventory", itemId);
    const item = inventory ?? (yield* store.items.remove("house", itemId));
    if (item === null) return;
    item.update({ context: "bank" });
    yield* store.items.upsert("bank", item);
  });

const withdraw = (store: Store, itemId: number) =>
  Effect.gen(function* () {
    const item = yield* store.items.remove("bank", itemId);
    if (item === null) return;
    const target = item.houseItem ? "house" : "inventory";
    item.update({ context: target });
    yield* store.items.upsert(target, item);
  });

const swap = (store: Store, inventoryItemId: number, bankItemId: number) =>
  Effect.gen(function* () {
    const inventoryItem = yield* store.items.get("inventory", inventoryItemId);
    const houseItem = yield* store.items.get("house", inventoryItemId);
    const bankItem = yield* store.items.get("bank", bankItemId);
    const itemToBank = inventoryItem ?? houseItem;
    if (itemToBank === null || bankItem === null) return;

    const source = inventoryItem === null ? "house" : "inventory";
    yield* store.items.remove(source, inventoryItemId);
    yield* store.items.remove("bank", bankItemId);

    itemToBank.update({ context: "bank" });
    yield* store.items.upsert("bank", itemToBank);

    const target = bankItem.houseItem ? "house" : "inventory";
    bankItem.update({ context: target });
    yield* store.items.upsert(target, bankItem);
  });

const consumeTurnInItem = (store: Store, item: TurnInItem) =>
  Effect.gen(function* () {
    const temporary = yield* store.items.get("temporary", item.itemId);
    const inventory =
      temporary === null
        ? yield* store.items.get("inventory", item.itemId)
        : null;
    const current = temporary ?? inventory;
    if (current === null) return;

    const container = temporary === null ? "inventory" : "temporary";
    const quantity = current.quantity - item.quantity;
    if (quantity <= 0) {
      yield* store.items.remove(container, current.itemId);
    } else {
      current.update({ quantity });
    }
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
            [data],
          );
          return [];
        }
        if (decoded.value.bitSuccess === false) return [];
        if (decoded.value.items !== undefined) {
          const context =
            packet.command === "loadHouseInventory" ? "house" : "inventory";
          const items = yield* decodeContainerItems(
            decoded.value.items ?? [],
            context,
            `items:${packet.command}:entries`,
            diagnose,
          );
          yield* store.items.replace(context, items);
        }
        if (decoded.value.hitems !== undefined) {
          const items = yield* decodeContainerItems(
            decoded.value.hitems,
            "house",
            `items:${packet.command}:house-entries`,
            diagnose,
          );
          yield* store.items.replace("house", items);
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
            [data],
          );
          return [];
        }
        if (decoded.value.bSuccess === false) return [];
        yield* packet.command === "bankFromInv"
          ? deposit(store, decoded.value.ItemID)
          : withdraw(store, decoded.value.ItemID);
        return [];
      }
      case "bankSwapInv": {
        const decoded = decodeBankSwap(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            "items:bankSwapInv",
            new Error("Malformed bank swap payload"),
            [data],
          );
          return [];
        }
        yield* swap(store, decoded.value.invItemID, decoded.value.bankItemID);
        return [];
      }
      case "dropItem": {
        const decoded = decodeItemsRecord(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            "items:dropItem",
            new Error("Malformed drop payload"),
            [data],
          );
          return [];
        }

        const values = Object.values(decoded.value.items);
        const drops = yield* decodeContainerItems(
          values,
          "drop",
          "items:dropItem:entries",
          diagnose,
        );
        for (const drop of drops) {
          yield* store.items.upsert("drop", drop);
        }
        return [];
      }
      case "equipItem":
      case "wearItem":
      case "unequipItem": {
        const decoded = decodeEquipmentMutation(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            `items:${packet.command}`,
            new Error("Malformed equipment payload"),
            [data],
          );
          return [];
        }
        const self = yield* store.world.getMe;
        if (
          decoded.value.success === false ||
          (decoded.value.uid !== undefined &&
            self?.entityId !== decoded.value.uid)
        ) {
          return [];
        }

        const containers = ["inventory", "temporary"] as const;
        for (const container of containers) {
          const item = yield* store.items.get(container, decoded.value.ItemID);
          if (item === null) continue;

          if (
            packet.command !== "unequipItem" &&
            decoded.value.strES !== undefined
          ) {
            const items = yield* store.items.getAll(container);
            for (const equipped of items) {
              if (equipped.equipmentSlot === decoded.value.strES) {
                equipped.update({ equipped: false });
              }
            }
          }
          item.update({ equipped: packet.command !== "unequipItem" });
          break;
        }
        return [];
      }
      case "getDrop": {
        const decoded = decodeItemMutation(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            "items:getDrop",
            new Error("Malformed drop response"),
            [data],
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
        for (const value of Object.values(decoded.value.items)) {
          const payload = decodeItem(value);
          if (Option.isNone(payload)) continue;
          const item = toItem(payload.value);
          yield* store.items.upsert(
            item.temporaryItem ? "temporary" : "inventory",
            item,
          );
        }
        return [];
      }
      case "turnIn": {
        const decoded = decodeQuestTurnIn(data);
        if (Option.isNone(decoded)) {
          yield* diagnose(
            "items:turnIn",
            new Error("Malformed quest turn-in payload"),
            [data],
          );
          return [];
        }
        if (decoded.value.sItems == null) return [];

        const { invalid, items } = parseTurnInItems(decoded.value.sItems);
        if (invalid.length > 0) {
          yield* diagnose(
            "items:turnIn:entries",
            new Error(`Ignored ${invalid.length} malformed turn-in entries`),
            invalid,
          );
        }
        for (const item of items) yield* consumeTurnInItem(store, item);
        return [];
      }
      case "removeItem":
      case "sellItem": {
        const decoded = decodeCharacterItemMutation(data);
        if (Option.isNone(decoded) || decoded.value.bSuccess === false)
          return [];
        const containers = decoded.value.bBank
          ? (["bank"] as const)
          : (["inventory", "house"] as const);
        let container: (typeof containers)[number] | undefined;
        let current: LiveItem | null = null;
        for (const candidate of containers) {
          current = yield* store.items.getByCharItemId(
            candidate,
            decoded.value.CharItemID,
          );
          if (current !== null) {
            container = candidate;
            break;
          }
        }
        if (container === undefined || current === null) return [];
        const quantity =
          decoded.value.iQtyNow ?? current.quantity - (decoded.value.iQty ?? 1);
        if (quantity <= 0) {
          yield* store.items.remove(container, current.itemId);
        } else {
          current.update({ quantity });
        }
        return [];
      }
      case "removeTempItem": {
        const decoded = decodeItemMutation(data);
        if (Option.isNone(decoded)) return [];
        const current = yield* store.items.get("temporary", {
          itemId: decoded.value.ItemID,
        });
        if (current === null) return [];
        const quantity =
          decoded.value.iQtyNow ?? current.quantity - (decoded.value.iQty ?? 1);
        if (quantity <= 0)
          yield* store.items.remove("temporary", current.itemId);
        else current.update({ quantity });
        return [];
      }
      default:
        return [];
    }
  });
