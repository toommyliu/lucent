import { Context, Effect, Layer, SynchronizedRef } from "effect";

import type { DropRecord, ItemRecord, ItemSelector } from "../Types";
import {
  asArray,
  asBoolean,
  asInt,
  asPositiveInt,
  asRecord,
  normalizeItemRecord,
} from "../payload";
import {
  itemMatchesSelector,
  normalizeItemSelector,
  normalizeQuantity,
} from "../selectors";

type ItemContainer = "bank" | "house" | "inventory" | "temp";

interface ItemsRuntimeState {
  bankCount: number;
  readonly bankItems: Map<number, ItemRecord>;
  readonly catalog: Map<number, ItemRecord>;
  readonly drops: Map<number, DropRecord>;
  readonly houseItems: Map<number, ItemRecord>;
  readonly inventoryItems: Map<number, ItemRecord>;
  readonly tempItems: Map<number, ItemRecord>;
}

export interface ItemsStateShape {
  readonly addDrop: (item: DropRecord) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly contains: (
    container: ItemContainer | "inventory-or-house",
    selector: ItemSelector,
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly get: (
    container: ItemContainer | "inventory-or-house",
    selector: ItemSelector,
  ) => Effect.Effect<ItemRecord | null>;
  readonly getAll: (
    container: ItemContainer,
  ) => Effect.Effect<readonly ItemRecord[]>;
  readonly getBankCount: Effect.Effect<number>;
  readonly getDrops: Effect.Effect<readonly DropRecord[]>;
  readonly getUsedSlots: (
    container: Exclude<ItemContainer, "bank">,
  ) => Effect.Effect<number>;
  readonly moveBankToInventory: (itemId: number) => Effect.Effect<void>;
  readonly moveInventoryToBank: (itemId: number) => Effect.Effect<void>;
  readonly reduceAddItems: (payload: unknown) => Effect.Effect<void>;
  readonly reduceBankSwap: (
    inventoryItemId: number,
    bankItemId: number,
  ) => Effect.Effect<void>;
  readonly reduceBuyItem: (
    payload: unknown,
    shopItem?: ItemRecord | null,
  ) => Effect.Effect<void>;
  readonly reduceDropItem: (payload: unknown) => Effect.Effect<void>;
  readonly reduceEnhancement: (payload: unknown) => Effect.Effect<void>;
  readonly reduceEquip: (
    itemId: number,
    equipped: boolean,
    slot?: string,
  ) => Effect.Effect<void>;
  readonly reduceGetDrop: (payload: unknown) => Effect.Effect<void>;
  readonly reduceRemoveItem: (payload: unknown) => Effect.Effect<void>;
  readonly reduceTurnIn: (payload: unknown) => Effect.Effect<void>;
  readonly replaceBank: (items: readonly unknown[]) => Effect.Effect<void>;
  readonly replaceHouse: (items: readonly unknown[]) => Effect.Effect<void>;
  readonly replaceInventory: (items: readonly unknown[]) => Effect.Effect<void>;
  readonly setBankCount: (count: number) => Effect.Effect<void>;
  readonly upsert: (
    container: ItemContainer,
    item: ItemRecord,
  ) => Effect.Effect<void>;
}

export class ItemsState extends Context.Service<ItemsState, ItemsStateShape>()(
  "lucent/game/flash/state/Items",
) {}

const initialState = (): ItemsRuntimeState => ({
  bankCount: 0,
  bankItems: new Map(),
  catalog: new Map(),
  drops: new Map(),
  houseItems: new Map(),
  inventoryItems: new Map(),
  tempItems: new Map(),
});

const mapForContainer = (
  state: ItemsRuntimeState,
  container: ItemContainer,
): Map<number, ItemRecord> => {
  switch (container) {
    case "bank":
      return state.bankItems;
    case "house":
      return state.houseItems;
    case "inventory":
      return state.inventoryItems;
    case "temp":
      return state.tempItems;
  }
};

const routeContainer = (item: ItemRecord): ItemContainer => {
  if (item.banked) {
    return "bank";
  }

  if (item.temp) {
    return "temp";
  }

  return item.house ? "house" : "inventory";
};

const normalizeForContainer = (
  item: ItemRecord,
  container: ItemContainer,
): ItemRecord => ({
  ...item,
  banked: container === "bank",
  house: container === "house" || item.house,
  temp: container === "temp" || item.temp,
});

const upsertItem = (
  state: ItemsRuntimeState,
  container: ItemContainer,
  item: ItemRecord,
): void => {
  const normalized = normalizeForContainer(item, container);
  mapForContainer(state, container).set(normalized.itemId, normalized);
  state.catalog.set(normalized.itemId, normalized);
};

const replaceItems = (
  state: ItemsRuntimeState,
  container: ItemContainer,
  items: readonly unknown[],
): void => {
  const target = mapForContainer(state, container);
  target.clear();
  for (const raw of items) {
    const item = normalizeItemRecord(raw, {
      banked: container === "bank",
      house: container === "house",
      temp: container === "temp",
    });
    if (item !== null) {
      upsertItem(state, container, item);
    }
  }
};

const findInMap = (
  items: Iterable<ItemRecord>,
  selector: ItemSelector,
): ItemRecord | null => {
  const normalized = normalizeItemSelector(selector);
  if (normalized === null) {
    return null;
  }

  return (
    Array.from(items).find((item) => itemMatchesSelector(item, normalized)) ??
    null
  );
};

const setEquipped = (
  state: ItemsRuntimeState,
  container: "inventory" | "temp",
  itemId: number,
  equipped: boolean,
  slot?: string,
): boolean => {
  const map = mapForContainer(state, container);
  const current = map.get(itemId);
  if (current === undefined) {
    return false;
  }

  const equipmentSlot = slot ?? current.equipmentSlot;
  if (equipped) {
    for (const [otherId, other] of map) {
      const sameEquipmentSlot =
        equipmentSlot !== "" && other.equipmentSlot === equipmentSlot;
      const sameConsumableCategory =
        current.category === "Item" && other.category === current.category;
      if (otherId !== itemId && (sameEquipmentSlot || sameConsumableCategory)) {
        map.set(otherId, { ...other, equipped: false });
      }
    }
  }

  map.set(itemId, {
    ...current,
    equipped,
    ...(slot === undefined ? {} : { equipmentSlot: slot }),
  });
  return true;
};

const removeQuantityByCharItemId = (
  state: ItemsRuntimeState,
  charItemId: number,
  quantity: number,
): void => {
  for (const container of ["inventory", "house", "temp"] as const) {
    const map = mapForContainer(state, container);
    for (const [itemId, item] of map) {
      if (item.charItemId !== charItemId) {
        continue;
      }

      const nextQuantity = Math.max(0, item.quantity - quantity);
      if (nextQuantity === 0 || item.category === "ar") {
        map.delete(itemId);
      } else {
        map.set(itemId, { ...item, quantity: nextQuantity });
      }
      return;
    }
  }
};

const removeQuantityByItemId = (
  state: ItemsRuntimeState,
  itemId: number,
  quantity: number,
  preferTemp: boolean,
): void => {
  const containers = preferTemp
    ? (["temp", "inventory", "house"] as const)
    : (["inventory", "house", "temp"] as const);
  for (const container of containers) {
    const map = mapForContainer(state, container);
    const item = map.get(itemId);
    if (item === undefined) {
      continue;
    }

    const nextQuantity = Math.max(0, item.quantity - quantity);
    if (nextQuantity === 0 || item.category === "ar") {
      map.delete(itemId);
    } else {
      map.set(itemId, { ...item, quantity: nextQuantity });
    }
    return;
  }
};

const itemRecordFromCatalog = (
  state: ItemsRuntimeState,
  itemId: number,
  payload: unknown,
): ItemRecord | null =>
  normalizeItemRecord(payload, state.catalog.get(itemId) ?? undefined);

export const layer = Layer.effect(
  ItemsState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make(initialState());

    return ItemsState.of({
      addDrop: (item) =>
        SynchronizedRef.update(ref, (state) => {
          state.drops.set(item.itemId, item);
          state.catalog.set(item.itemId, item);
          return state;
        }),
      clear: SynchronizedRef.update(ref, () => initialState()),
      contains: (container, selector, quantity) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => {
            const needed = normalizeQuantity(quantity);
            if (container === "inventory-or-house") {
              const item =
                findInMap(state.inventoryItems.values(), selector) ??
                findInMap(state.houseItems.values(), selector);
              return item !== null && item.quantity >= needed;
            }

            const item = findInMap(
              mapForContainer(state, container).values(),
              selector,
            );
            return item !== null && item.quantity >= needed;
          }),
        ),
      get: (container, selector) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => {
            if (container === "inventory-or-house") {
              return (
                findInMap(state.inventoryItems.values(), selector) ??
                findInMap(state.houseItems.values(), selector)
              );
            }

            return findInMap(
              mapForContainer(state, container).values(),
              selector,
            );
          }),
        ),
      getAll: (container) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) =>
            Array.from(mapForContainer(state, container).values()),
          ),
        ),
      getBankCount: SynchronizedRef.get(ref).pipe(
        Effect.map((state) => state.bankCount),
      ),
      getDrops: SynchronizedRef.get(ref).pipe(
        Effect.map((state) => Array.from(state.drops.values())),
      ),
      getUsedSlots: (container) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => mapForContainer(state, container).size),
        ),
      moveBankToInventory: (itemId) =>
        SynchronizedRef.update(ref, (state) => {
          const item = state.bankItems.get(itemId);
          if (item === undefined) {
            return state;
          }

          state.bankItems.delete(itemId);
          upsertItem(state, item.house ? "house" : "inventory", {
            ...item,
            banked: false,
          });
          state.bankCount = Math.max(0, state.bankCount - 1);
          return state;
        }),
      moveInventoryToBank: (itemId) =>
        SynchronizedRef.update(ref, (state) => {
          const item =
            state.inventoryItems.get(itemId) ?? state.houseItems.get(itemId);
          if (item === undefined) {
            return state;
          }

          state.inventoryItems.delete(itemId);
          state.houseItems.delete(itemId);
          upsertItem(state, "bank", { ...item, banked: true, equipped: false });
          state.bankCount += item.coins ? 0 : 1;
          return state;
        }),
      reduceAddItems: (payload) =>
        SynchronizedRef.update(ref, (state) => {
          const record = asRecord(payload);
          const source = asRecord(record?.["items"]) ?? record;
          if (source === null) {
            return state;
          }

          for (const [rawItemId, rawItem] of Object.entries(source)) {
            const itemId = asPositiveInt(rawItemId);
            const item = itemRecordFromCatalog(state, itemId ?? 0, rawItem);
            if (item !== null) {
              upsertItem(state, routeContainer(item), item);
            }
          }
          return state;
        }),
      reduceBankSwap: (inventoryItemId, bankItemId) =>
        SynchronizedRef.update(ref, (state) => {
          const inventoryItem =
            state.inventoryItems.get(inventoryItemId) ??
            state.houseItems.get(inventoryItemId);
          const bankItem = state.bankItems.get(bankItemId);
          if (inventoryItem === undefined || bankItem === undefined) {
            return state;
          }

          state.inventoryItems.delete(inventoryItemId);
          state.houseItems.delete(inventoryItemId);
          state.bankItems.delete(bankItemId);
          upsertItem(state, "bank", {
            ...inventoryItem,
            banked: true,
            equipped: false,
          });
          upsertItem(state, bankItem.house ? "house" : "inventory", {
            ...bankItem,
            banked: false,
          });
          return state;
        }),
      reduceBuyItem: (payload, shopItem) =>
        SynchronizedRef.update(ref, (state) => {
          const record = asRecord(payload);
          if (record === null || asBoolean(record["bitSuccess"]) === false) {
            return state;
          }

          const itemId = asPositiveInt(record["ItemID"] ?? shopItem?.itemId);
          const source =
            shopItem === null || shopItem === undefined
              ? record
              : { ...shopItem, ...record };
          const item =
            itemId === undefined
              ? normalizeItemRecord(source)
              : itemRecordFromCatalog(state, itemId, source);
          if (item !== null && !item.virtual) {
            upsertItem(state, routeContainer(item), item);
          }
          return state;
        }),
      reduceDropItem: (payload) =>
        SynchronizedRef.update(ref, (state) => {
          const items = asRecord(asRecord(payload)?.["items"]);
          if (items === null) {
            return state;
          }

          for (const [rawDropId, rawItem] of Object.entries(items)) {
            const item = normalizeItemRecord(rawItem);
            if (item === null) {
              continue;
            }
            const dropId = asPositiveInt(rawDropId) ?? item.itemId;
            const dropQuantity =
              asInt(asRecord(rawItem)?.["iQty"]) ?? item.quantity;
            const drop = { ...item, dropId, dropQuantity };
            state.drops.set(item.itemId, drop);
            state.catalog.set(item.itemId, item);
          }
          return state;
        }),
      reduceEnhancement: (payload) =>
        SynchronizedRef.update(ref, (state) => {
          const record = asRecord(payload);
          if (record === null) {
            return state;
          }

          const ids = new Set<number>();
          for (const id of asArray(record["ItemIDs"])) {
            const parsed = asPositiveInt(id);
            if (parsed !== undefined) {
              ids.add(parsed);
            }
          }
          const single = asPositiveInt(record["ItemID"]);
          if (single !== undefined) {
            ids.add(single);
          }

          for (const container of ["inventory", "house"] as const) {
            const map = mapForContainer(state, container);
            for (const [itemId, item] of map) {
              if (!ids.has(itemId)) {
                continue;
              }
              const next = normalizeItemRecord(record, item);
              if (next !== null) {
                map.set(itemId, next);
              }
            }
          }
          return state;
        }),
      reduceEquip: (itemId, equipped, slot) =>
        SynchronizedRef.update(ref, (state) => {
          setEquipped(state, "inventory", itemId, equipped, slot);
          setEquipped(state, "temp", itemId, equipped, slot);
          return state;
        }),
      reduceGetDrop: (payload) =>
        SynchronizedRef.update(ref, (state) => {
          const record = asRecord(payload);
          const itemId = asPositiveInt(record?.["ItemID"]);
          if (
            record === null ||
            itemId === undefined ||
            asBoolean(record["bSuccess"]) === false
          ) {
            return state;
          }

          const base = state.catalog.get(itemId) ?? state.drops.get(itemId);
          const item = normalizeItemRecord({ ...base, ...record }, base);
          if (item !== null) {
            upsertItem(state, routeContainer(item), item);
          }
          state.drops.delete(itemId);
          return state;
        }),
      reduceRemoveItem: (payload) =>
        SynchronizedRef.update(ref, (state) => {
          const record = asRecord(payload);
          if (record === null) {
            return state;
          }

          const charItemId = asPositiveInt(record["CharItemID"]);
          if (asBoolean(record["bBank"]) === true) {
            const itemId = asPositiveInt(record["ItemID"]);
            if (itemId !== undefined) {
              state.bankItems.delete(itemId);
            }
            return state;
          }

          if (charItemId !== undefined) {
            removeQuantityByCharItemId(
              state,
              charItemId,
              normalizeQuantity(asInt(record["iQty"])),
            );
          }
          return state;
        }),
      reduceTurnIn: (payload) =>
        SynchronizedRef.update(ref, (state) => {
          const sItems = asRecord(payload)?.["sItems"];
          if (typeof sItems !== "string" || sItems.length < 3) {
            return state;
          }

          for (const token of sItems.split(",")) {
            const [rawItemId, rawQuantity] = token.split(":");
            const itemId = asPositiveInt(rawItemId);
            if (itemId === undefined) {
              continue;
            }

            const quantity = normalizeQuantity(asInt(rawQuantity));
            const preferTemp = state.catalog.get(itemId)?.temp === true;
            removeQuantityByItemId(state, itemId, quantity, preferTemp);
          }
          return state;
        }),
      replaceBank: (items) =>
        SynchronizedRef.update(ref, (state) => {
          replaceItems(state, "bank", items);
          state.bankCount = state.bankItems.size;
          return state;
        }),
      replaceHouse: (items) =>
        SynchronizedRef.update(ref, (state) => {
          replaceItems(state, "house", items);
          return state;
        }),
      replaceInventory: (items) =>
        SynchronizedRef.update(ref, (state) => {
          replaceItems(state, "inventory", items);
          return state;
        }),
      setBankCount: (count) =>
        SynchronizedRef.update(ref, (state) => {
          state.bankCount = Math.max(0, Math.trunc(count));
          return state;
        }),
      upsert: (container, item) =>
        SynchronizedRef.update(ref, (state) => {
          upsertItem(state, container, item);
          return state;
        }),
    });
  }),
);
