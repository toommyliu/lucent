import type {
  GrabbedData,
  GrabbedDataByType,
  GrabbedItem,
  LoaderGrabberGrabType,
} from "../../../shared/loader-grabber";
import { formatItemEnhancement } from "@lucent/game";

export interface TreeItem {
  readonly children?: readonly TreeItem[];
  readonly name: string;
  readonly raw?: unknown;
  readonly value?: string;
}

export interface FlattenedTreeItem extends TreeItem {
  readonly hasChildren: boolean;
  readonly index: number;
  readonly isLastSibling: boolean;
  readonly level: number;
  readonly nodeId: string;
}

export interface VisibleTreeItems {
  readonly autoExpandedNodeIds: ReadonlySet<string>;
  readonly items: readonly FlattenedTreeItem[];
  readonly matchedRootCount: number;
}

export interface FilteredTreeRoot {
  readonly item: TreeItem;
  readonly nodeId: string;
}

const printable = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const node = (name: string, value: unknown): TreeItem => ({
  name,
  value: printable(value),
});

const optionalNode = (name: string, value: unknown): TreeItem | undefined => {
  const text = printable(value).trim();
  return text === "" ? undefined : { name, value: text };
};

const compact = (
  items: readonly (TreeItem | undefined)[],
): readonly TreeItem[] =>
  items.filter((item): item is TreeItem => item !== undefined);

const itemName = (item: Pick<GrabbedItem, "name">): string =>
  item.name.trim() === "" ? "Unnamed item" : item.name;

const enhancementText = (item: GrabbedItem): string | undefined =>
  formatItemEnhancement(item.enhancement);

const itemTree = (
  item: GrabbedItem,
  options: { readonly includeShopId?: boolean; readonly temporary?: boolean },
): TreeItem => ({
  children: compact([
    options.includeShopId
      ? optionalNode("Shop Item ID", item.shopItemId)
      : optionalNode("Char Item ID", item.charItemId),
    node("ID", item.itemId),
    node("Quantity", item.quantity),
    options.temporary ? undefined : node("Cost", item.cost),
    options.temporary
      ? undefined
      : node("AC Tagged", item.coins ? "Yes" : "No"),
    options.temporary ? undefined : node("Category", item.category),
    options.temporary
      ? undefined
      : optionalNode("Enhancement", enhancementText(item)),
    options.temporary
      ? undefined
      : optionalNode("Description", item.description),
  ]),
  name: itemName(item),
  raw: item,
});

const buildShop = (shop: GrabbedDataByType["shop"]): readonly TreeItem[] =>
  shop.items.map((item) => itemTree(item, { includeShopId: true }));

const questAvailabilityText = (
  quest: GrabbedDataByType["quest"][number],
): string => {
  if (quest.once) {
    return "Can only be completed once";
  }

  switch (quest.cadence) {
    case "daily":
      return "Can be completed once per day";
    case "weekly":
      return "Can be completed once per week";
    case "monthly":
      return "Can be completed once per month";
    case "none":
      return "Can be completed repeatedly";
  }
};

const buildQuests = (quests: GrabbedDataByType["quest"]): readonly TreeItem[] =>
  quests.map((quest) => {
    const requirements = quest.requirements.map(
      (item): TreeItem => ({
        children: compact([
          node("ID", item.itemId),
          node("Quantity", item.quantity),
          item.temporaryItem === undefined
            ? undefined
            : node("Temporary", item.temporaryItem ? "Yes" : "No"),
        ]),
        name: item.name || "Unnamed item",
        raw: item,
      }),
    );
    const rewards = quest.rewards.map(
      (item): TreeItem => ({
        children: compact([
          node("ID", item.itemId),
          node("Quantity", item.quantity),
          item.dropChance === undefined
            ? undefined
            : node("Drop chance", `${item.dropChance}%`),
        ]),
        name: item.name || "Unnamed item",
        raw: item,
      }),
    );

    return {
      children: compact([
        node("ID", quest.id),
        node("Availability", questAvailabilityText(quest)),
        requirements.length === 0
          ? undefined
          : { children: requirements, name: "Required Items" },
        rewards.length === 0
          ? undefined
          : { children: rewards, name: "Rewards" },
      ]),
      name: `${quest.id} - ${quest.name}`,
      raw: quest,
    };
  });

const buildItems = (
  items: readonly GrabbedItem[],
  temporary = false,
): readonly TreeItem[] => items.map((item) => itemTree(item, { temporary }));

const buildMonsters = (
  monsters:
    | GrabbedDataByType["cell-monsters"]
    | GrabbedDataByType["map-monsters"],
  includeHealth: boolean,
): readonly TreeItem[] =>
  monsters.map((monster) => ({
    children: [
      node("ID", monster.monsterId),
      node("MonMapID", monster.monsterMapId),
      node("Race", monster.race),
      node("Level", monster.level),
      includeHealth
        ? node("Health", `${monster.hp}/${monster.maxHp}`)
        : node("Cell", monster.cell),
    ],
    name: monster.name.trim() === "" ? "Unnamed monster" : monster.name,
    raw: monster,
  }));

export const buildGrabbedDataTree = (
  type: LoaderGrabberGrabType,
  data: GrabbedData,
): readonly TreeItem[] => {
  switch (type) {
    case "shop":
      return typeof data === "object" &&
        data !== null &&
        !Array.isArray(data) &&
        "items" in data &&
        Array.isArray(data.items)
        ? buildShop(data as GrabbedDataByType["shop"])
        : [];
    case "quest":
      return Array.isArray(data)
        ? buildQuests(data as GrabbedDataByType["quest"])
        : [];
    case "inventory":
    case "bank":
      return Array.isArray(data)
        ? buildItems(data as GrabbedDataByType["inventory"])
        : [];
    case "temp-inventory":
      return Array.isArray(data)
        ? buildItems(data as GrabbedDataByType["temp-inventory"], true)
        : [];
    case "cell-monsters":
      return Array.isArray(data)
        ? buildMonsters(data as GrabbedDataByType["cell-monsters"], true)
        : [];
    case "map-monsters":
      return Array.isArray(data)
        ? buildMonsters(data as GrabbedDataByType["map-monsters"], false)
        : [];
  }
};

const pathId = (path: readonly number[]): string => path.join(".");

const itemMatches = (item: TreeItem, query: string): boolean =>
  item.name.toLocaleLowerCase().includes(query) ||
  (item.value?.toLocaleLowerCase().includes(query) ?? false);

const itemOrDescendantMatches = (item: TreeItem, query: string): boolean =>
  itemMatches(item, query) ||
  (item.children?.some((child) => itemOrDescendantMatches(child, query)) ??
    false);

export const filterTreeRoots = (
  data: readonly TreeItem[],
  query: string,
): readonly FilteredTreeRoot[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return data.flatMap((item, index) =>
    normalizedQuery === "" || itemOrDescendantMatches(item, normalizedQuery)
      ? [{ item, nodeId: String(index) }]
      : [],
  );
};

export const buildVisibleTreeItems = (
  data: readonly TreeItem[],
  expandedNodeIds: ReadonlySet<string>,
  query: string,
): VisibleTreeItems => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const autoExpandedNodeIds = new Set<string>();
  const matchesById = new Map<string, boolean>();

  const inspect = (item: TreeItem, path: readonly number[]): boolean => {
    let descendantMatches = false;
    item.children?.forEach((child, index) => {
      descendantMatches = inspect(child, [...path, index]) || descendantMatches;
    });
    const matches =
      normalizedQuery === "" ||
      itemMatches(item, normalizedQuery) ||
      descendantMatches;
    const id = pathId(path);
    matchesById.set(id, matches);
    if (normalizedQuery !== "" && descendantMatches) {
      autoExpandedNodeIds.add(id);
    }
    return matches;
  };

  data.forEach((item, index) => inspect(item, [index]));
  const visibleRoots = data
    .map((item, index) => ({ index, item }))
    .filter(({ index }) => matchesById.get(pathId([index])) === true);
  const items: FlattenedTreeItem[] = [];

  const append = (
    item: TreeItem,
    path: readonly number[],
    level: number,
    isLastSibling: boolean,
  ): void => {
    const nodeId = pathId(path);
    const children = item.children ?? [];
    items.push({
      ...item,
      hasChildren: children.length > 0,
      index: items.length,
      isLastSibling,
      level,
      nodeId,
    });

    const expanded =
      normalizedQuery === ""
        ? expandedNodeIds.has(nodeId)
        : autoExpandedNodeIds.has(nodeId);
    if (!expanded) {
      return;
    }
    const visibleChildren = children
      .map((child, index) => ({ child, index }))
      .filter(
        ({ index }) => matchesById.get(pathId([...path, index])) === true,
      );
    visibleChildren.forEach(({ child, index }, visibleIndex) => {
      append(
        child,
        [...path, index],
        level + 1,
        visibleIndex === visibleChildren.length - 1,
      );
    });
  };

  visibleRoots.forEach(({ index, item }, visibleIndex) => {
    append(item, [index], 0, visibleIndex === visibleRoots.length - 1);
  });

  return {
    autoExpandedNodeIds,
    items,
    matchedRootCount: visibleRoots.length,
  };
};

export const toTreeJson = (item: TreeItem): unknown => {
  if (item.raw !== undefined) {
    return item.raw;
  }
  if (item.children !== undefined && item.children.length > 0) {
    return {
      name: item.name,
      children: item.children.map(toTreeJson),
      ...(item.value === undefined ? {} : { value: item.value }),
    };
  }
  return item.value === undefined
    ? { name: item.name }
    : { name: item.name, value: item.value };
};
