import type { ItemQuery, ShopItemQuery } from "@lucent/game";
import { LiveItem } from "@lucent/game";

export type ItemContainer =
  | "bank"
  | "drop"
  | "house"
  | "inventory"
  | "shop"
  | "temporary";

export interface ItemsState {
  readonly charItemIds: Map<ItemContainer, Map<number, number>>;
  readonly containers: Map<ItemContainer, Map<number, LiveItem>>;
  readonly itemIds: Map<ItemContainer, Map<number, Set<number>>>;
  readonly hydration: Map<ItemContainer, number>;
  readonly names: Map<ItemContainer, Map<string, Set<number>>>;
}

const containers: readonly ItemContainer[] = [
  "bank",
  "drop",
  "house",
  "inventory",
  "shop",
  "temporary",
];

export const normalizeItemName = (name: string): string =>
  name.trim().toLowerCase();

export const itemKey = (container: ItemContainer, item: LiveItem): number =>
  container === "shop" ? (item.shopItemId ?? item.itemId) : item.itemId;

export const makeItemsState = (): ItemsState => ({
  charItemIds: new Map(containers.map((container) => [container, new Map()])),
  containers: new Map(containers.map((container) => [container, new Map()])),
  itemIds: new Map(containers.map((container) => [container, new Map()])),
  hydration: new Map(containers.map((container) => [container, 0])),
  names: new Map(containers.map((container) => [container, new Map()])),
});

const values = (state: ItemsState, container: ItemContainer) =>
  state.containers.get(container)!;

const names = (state: ItemsState, container: ItemContainer) =>
  state.names.get(container)!;

const itemIds = (state: ItemsState, container: ItemContainer) =>
  state.itemIds.get(container)!;

const charItemIds = (state: ItemsState, container: ItemContainer) =>
  state.charItemIds.get(container)!;

const removeIndexKey = (
  index: Map<number, Set<number>>,
  value: number,
  key: number,
): void => {
  const keys = index.get(value);
  if (keys === undefined) return;

  keys.delete(key);
  if (keys.size === 0) index.delete(value);
};

const addIndexKey = (
  index: Map<number, Set<number>>,
  value: number,
  key: number,
): void => {
  const keys = index.get(value) ?? new Set<number>();
  keys.add(key);
  index.set(value, keys);
};

const removeNameIndex = (
  state: ItemsState,
  container: ItemContainer,
  key: number,
  name: string,
): void => {
  const index = names(state, container);
  const ids = index.get(normalizeItemName(name));
  if (ids === undefined) return;
  ids.delete(key);
  if (ids.size === 0) index.delete(normalizeItemName(name));
};

const addNameIndex = (
  state: ItemsState,
  container: ItemContainer,
  key: number,
  name: string,
): void => {
  const index = names(state, container);
  const normalized = normalizeItemName(name);
  const ids = index.get(normalized) ?? new Set<number>();
  ids.add(key);
  index.set(normalized, ids);
};

const removeItemIndexes = (
  state: ItemsState,
  container: ItemContainer,
  key: number,
  item: LiveItem,
): void => {
  removeNameIndex(state, container, key, item.name);
  removeIndexKey(itemIds(state, container), item.itemId, key);
  if (item.charItemId !== undefined) {
    charItemIds(state, container).delete(item.charItemId);
  }
};

const addItemIndexes = (
  state: ItemsState,
  container: ItemContainer,
  key: number,
  item: LiveItem,
): void => {
  addNameIndex(state, container, key, item.name);
  addIndexKey(itemIds(state, container), item.itemId, key);
  if (item.charItemId !== undefined) {
    charItemIds(state, container).set(item.charItemId, key);
  }
};

export const upsertItem = (
  state: ItemsState,
  container: ItemContainer,
  incoming: LiveItem,
): LiveItem => {
  const items = values(state, container);
  const key = itemKey(container, incoming);
  const current = items.get(key);
  if (current === undefined) {
    items.set(key, incoming);
    addItemIndexes(state, container, key, incoming);
    return incoming;
  }

  removeItemIndexes(state, container, key, current);
  current.replaceFrom(incoming);
  addItemIndexes(state, container, key, current);
  return current;
};

export const replaceItems = (
  state: ItemsState,
  container: ItemContainer,
  incoming: readonly LiveItem[],
): void => {
  const nextKeys = new Set(incoming.map((item) => itemKey(container, item)));
  const current = values(state, container);
  for (const [key, item] of current) {
    if (nextKeys.has(key)) continue;
    current.delete(key);
    removeItemIndexes(state, container, key, item);
  }
  for (const item of incoming) upsertItem(state, container, item);
  state.hydration.set(container, (state.hydration.get(container) ?? 0) + 1);
};

export const clearItems = (state: ItemsState): void => {
  for (const container of containers) {
    state.charItemIds.get(container)?.clear();
    state.containers.get(container)?.clear();
    state.itemIds.get(container)?.clear();
    state.names.get(container)?.clear();
    state.hydration.set(container, 0);
  }
};

export const removeItem = (
  state: ItemsState,
  container: ItemContainer,
  key: number,
): LiveItem | null => {
  const items = values(state, container);
  const current = items.get(key);
  if (current === undefined) return null;
  items.delete(key);
  removeItemIndexes(state, container, key, current);
  return current;
};

export const getItem = (
  state: ItemsState,
  container: ItemContainer,
  selector: ItemQuery | ShopItemQuery,
): LiveItem | null => {
  const items = values(state, container);
  if (typeof selector === "number") return items.get(selector) ?? null;
  if (typeof selector === "string") {
    const key = names(state, container)
      .get(normalizeItemName(selector))
      ?.values()
      .next().value;
    return key === undefined ? null : (items.get(key) ?? null);
  }
  if ("shopItemId" in selector) return items.get(selector.shopItemId) ?? null;
  if ("itemId" in selector) {
    const key = itemIds(state, container)
      .get(selector.itemId)
      ?.values()
      .next().value;
    return key === undefined ? null : (items.get(key) ?? null);
  }
  const key = names(state, container)
    .get(normalizeItemName(selector.name))
    ?.values()
    .next().value;
  return key === undefined ? null : (items.get(key) ?? null);
};

export const getItems = (
  state: ItemsState,
  container: ItemContainer,
): readonly LiveItem[] => Array.from(values(state, container).values());

export const getItemByCharItemId = (
  state: ItemsState,
  container: ItemContainer,
  charItemId: number,
): LiveItem | null => {
  const key = charItemIds(state, container).get(charItemId);
  return key === undefined ? null : (values(state, container).get(key) ?? null);
};
