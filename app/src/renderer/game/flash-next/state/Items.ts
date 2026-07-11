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
  readonly containers: Map<ItemContainer, Map<number, LiveItem>>;
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
  containers: new Map(containers.map((container) => [container, new Map()])),
  names: new Map(containers.map((container) => [container, new Map()])),
});

const values = (state: ItemsState, container: ItemContainer) =>
  state.containers.get(container)!;

const names = (state: ItemsState, container: ItemContainer) =>
  state.names.get(container)!;

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
    addNameIndex(state, container, key, incoming.name);
    return incoming;
  }

  removeNameIndex(state, container, key, current.name);
  current.replaceFrom(incoming);
  addNameIndex(state, container, key, current.name);
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
    removeNameIndex(state, container, key, item.name);
  }
  for (const item of incoming) upsertItem(state, container, item);
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
  removeNameIndex(state, container, key, current.name);
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
    return (
      Array.from(items.values()).find(
        (item) => item.itemId === selector.itemId,
      ) ?? null
    );
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
