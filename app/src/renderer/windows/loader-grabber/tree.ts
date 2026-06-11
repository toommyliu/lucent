import { getEnhancementName, getWeaponProcName } from "@lucent/game";
import type {
  GrabbedData,
  GrabbedDataByType,
  LoaderGrabberGrabType,
} from "../../../shared/loader-grabber";

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

const stringValue = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const leaf = (name: string, value: unknown): TreeItem => ({
  name,
  value: stringValue(value),
});

const hasValue = (value: unknown): boolean => {
  const normalized = stringValue(value).trim();
  return (
    normalized !== "" && normalized !== "undefined" && normalized !== "null"
  );
};

const optionalLeaf = (name: string, value: unknown): TreeItem | undefined =>
  hasValue(value) ? leaf(name, value) : undefined;

const compactTreeItems = (
  items: readonly (TreeItem | undefined)[],
): TreeItem[] => items.filter((item): item is TreeItem => item !== undefined);

const itemName = (item: { readonly sName?: unknown }): string =>
  hasValue(item.sName) ? stringValue(item.sName) : "Unnamed item";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asArray = <T>(value: unknown): readonly T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const truthyFlag = (value: unknown): boolean =>
  value === true || value === 1 || value === "1";

const toItemIdKey = (value: unknown): string | undefined => {
  if (typeof value !== "number" && typeof value !== "string") {
    return undefined;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const itemId = Math.trunc(parsed);
  return itemId > 0 ? String(itemId) : undefined;
};

const buildShopTree = (data: GrabbedDataByType["shop"]): readonly TreeItem[] =>
  data.items.map((item) => ({
    children: [
      leaf("Shop Item ID", item.ShopItemID),
      leaf("ID", item.ItemID),
      leaf("Cost", `${item.iCost} ${item.bCoins === 1 ? "ACs" : "Gold"}`),
      leaf("Category", item.sType),
      leaf("Description", item.sDesc),
    ],
    name: itemName(item),
    raw: item,
  }));

type QuestItemRecord = {
  readonly DropChance?: unknown;
  readonly ItemID?: unknown;
  readonly bTemp?: unknown;
  readonly iQty?: unknown;
  readonly iRate?: unknown;
  readonly sDesc?: unknown;
  readonly sName?: unknown;
};

interface QuestTreeEntry {
  readonly item: QuestItemRecord;
  readonly metadata: QuestItemRecord | undefined;
}

const collectQuestItemRecords = (
  value: unknown,
  items: QuestItemRecord[],
): void => {
  if (!isRecord(value)) {
    return;
  }

  if (toItemIdKey(value["ItemID"]) !== undefined) {
    items.push(value as QuestItemRecord);
    return;
  }

  for (const child of Object.values(value)) {
    collectQuestItemRecords(child, items);
  }
};

const questItemRecords = (value: unknown): QuestItemRecord[] => {
  const items: QuestItemRecord[] = [];
  collectQuestItemRecords(value, items);
  return items;
};

const questItemRecordsById = (value: unknown): Map<string, QuestItemRecord> => {
  const items = new Map<string, QuestItemRecord>();
  for (const item of questItemRecords(value)) {
    const itemId = toItemIdKey(item.ItemID);
    if (itemId !== undefined) {
      items.set(itemId, item);
    }
  }

  return items;
};

const questItemValue = (
  entry: QuestTreeEntry,
  field: keyof QuestItemRecord,
): unknown => {
  const itemValue = entry.item[field];
  return hasValue(itemValue) ? itemValue : entry.metadata?.[field];
};

const questEntryName = (entry: QuestTreeEntry): string =>
  itemName({ sName: questItemValue(entry, "sName") });

const questEntryRaw = (entry: QuestTreeEntry): QuestItemRecord => {
  if (entry.metadata === undefined) {
    return entry.item;
  }

  const merged: Record<string, unknown> = { ...entry.metadata };
  for (const [key, value] of Object.entries(entry.item)) {
    if (hasValue(value)) {
      merged[key] = value;
    }
  }

  return merged as QuestItemRecord;
};

const addQuestEntry = (
  entries: QuestTreeEntry[],
  seen: Set<string>,
  item: QuestItemRecord,
  metadataById: ReadonlyMap<string, QuestItemRecord>,
): void => {
  const itemId = toItemIdKey(item.ItemID);
  const key = itemId ?? `unknown:${entries.length}:${stringValue(item.sName)}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  entries.push({
    item,
    metadata: itemId === undefined ? undefined : metadataById.get(itemId),
  });
};

const buildQuestEntries = (
  sources: readonly unknown[],
  metadataSource: unknown,
): QuestTreeEntry[] => {
  const metadataById = questItemRecordsById(metadataSource);
  const entries: QuestTreeEntry[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const item of asArray<QuestItemRecord>(source)) {
      addQuestEntry(entries, seen, item, metadataById);
    }
  }

  for (const item of metadataById.values()) {
    addQuestEntry(entries, seen, item, metadataById);
  }

  return entries;
};

const buildRequiredItemTree = (entry: QuestTreeEntry): TreeItem => {
  const bTemp = questItemValue(entry, "bTemp");

  return {
    children: compactTreeItems([
      optionalLeaf("ID", questItemValue(entry, "ItemID")),
      optionalLeaf("Quantity", questItemValue(entry, "iQty")),
      bTemp === undefined
        ? undefined
        : leaf("Temporary", truthyFlag(bTemp) ? "Yes" : "No"),
      optionalLeaf("Description", questItemValue(entry, "sDesc")),
    ]),
    name: questEntryName(entry),
    raw: questEntryRaw(entry),
  };
};

const rewardDropChance = (entry: QuestTreeEntry): unknown => {
  const dropChance = questItemValue(entry, "DropChance");
  if (hasValue(dropChance)) {
    return dropChance;
  }

  const rate = questItemValue(entry, "iRate");
  if (!hasValue(rate)) {
    return undefined;
  }

  const normalized = stringValue(rate).trim();
  return normalized.endsWith("%") ? normalized : `${normalized}%`;
};

const buildRewardItemTree = (entry: QuestTreeEntry): TreeItem => ({
  children: compactTreeItems([
    optionalLeaf("ID", questItemValue(entry, "ItemID")),
    optionalLeaf("Quantity", questItemValue(entry, "iQty")),
    optionalLeaf("Drop chance", rewardDropChance(entry)),
  ]),
  name: questEntryName(entry),
  raw: questEntryRaw(entry),
});

const questSection = (
  name: string,
  children: readonly TreeItem[],
): TreeItem | undefined =>
  children.length === 0
    ? undefined
    : {
        children,
        name,
      };

const buildQuestTree = (
  data: GrabbedDataByType["quest"],
): readonly TreeItem[] =>
  data.map((quest) => {
    const requiredItems = buildQuestEntries(
      [quest.RequiredItems, quest.turnin],
      quest.oItems,
    ).map(buildRequiredItemTree);
    const rewards = buildQuestEntries(
      [quest.Rewards, quest.reward],
      quest.oRewards,
    ).map(buildRewardItemTree);

    return {
      children: compactTreeItems([
        leaf("ID", quest.QuestID),
        optionalLeaf("Description", quest.sDesc),
        questSection("Required Items", requiredItems),
        questSection("Rewards", rewards),
      ]),
      name: `${quest.QuestID} - ${quest.sName}`,
      raw: quest,
    };
  });

const buildInventoryTree = (
  data: GrabbedDataByType["inventory"],
): readonly TreeItem[] =>
  data.map((item) => {
    const children: TreeItem[] = [
      leaf("ID", item.ItemID),
      leaf("Char Item ID", item.CharItemID),
      leaf(
        "Quantity",
        item.sType === "Class" ? "1/1" : `${item.iQty}/${item.iStk}`,
      ),
      leaf("AC Tagged", item.bCoins === 1 ? "Yes" : "No"),
      leaf("Category", item.sType),
    ];
    const enhancementName = getEnhancementName(item.EnhPatternID);
    const procName = item.ProcID ? getWeaponProcName(item.ProcID) : "";
    const validProcName = procName && procName !== "Unknown" ? procName : "";
    const enhancement = [enhancementName, validProcName]
      .filter(Boolean)
      .join(", ");
    if (enhancement !== "") {
      children.push(leaf("Enhancement", enhancement));
    }
    children.push(leaf("Description", item.sDesc));

    return {
      children,
      name: itemName(item),
      raw: item,
    };
  });

const buildTempInventoryTree = (
  data: GrabbedDataByType["temp-inventory"],
): readonly TreeItem[] =>
  data.map((item) => ({
    children: [
      leaf("ID", item.ItemID),
      leaf("Quantity", `${item.iQty}/${item.iStk}`),
    ],
    name: itemName(item),
    raw: item,
  }));

const buildMonsterTree = (
  data: GrabbedDataByType["cell-monsters"],
  includeHp: boolean,
): readonly TreeItem[] =>
  data.map((monster) => ({
    children: [
      leaf("ID", monster.monId),
      leaf("MonMapID", monster.monMapId),
      leaf("Race", monster.sRace),
      leaf("Level", "intLevel" in monster ? monster.intLevel : monster.iLvl),
      includeHp
        ? leaf("Health", `${monster.intHP}/${monster.intHPMax}`)
        : leaf("Cell", monster.strFrame),
    ],
    name: hasValue(monster.strMonName)
      ? stringValue(monster.strMonName)
      : "Unnamed monster",
    raw: monster,
  }));

const builders: {
  readonly [Type in LoaderGrabberGrabType]: (
    data: GrabbedDataByType[Type],
  ) => readonly TreeItem[];
} = {
  bank: buildInventoryTree,
  "cell-monsters": (data) => buildMonsterTree(data, true),
  inventory: buildInventoryTree,
  "map-monsters": (data) => buildMonsterTree(data, false),
  quest: buildQuestTree,
  shop: buildShopTree,
  "temp-inventory": buildTempInventoryTree,
};

export const buildGrabbedDataTree = (
  type: LoaderGrabberGrabType,
  data: GrabbedData,
): readonly TreeItem[] => {
  if (type === "shop") {
    return isRecord(data) && Array.isArray(data.items)
      ? buildShopTree(data as GrabbedDataByType["shop"])
      : [];
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return builders[type](data as never);
};

const nodeMatchesQuery = (item: TreeItem, query: string): boolean => {
  if (query === "") {
    return true;
  }

  const normalizedName = item.name.toLocaleLowerCase();
  const normalizedValue = item.value?.toLocaleLowerCase() ?? "";
  return normalizedName.includes(query) || normalizedValue.includes(query);
};

const nodeIdFor = (path: readonly number[]): string => path.join(".");

export const buildVisibleTreeItems = (
  data: readonly TreeItem[],
  expandedNodeIds: ReadonlySet<string>,
  query: string,
): VisibleTreeItems => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const items: FlattenedTreeItem[] = [];
  const autoExpandedNodeIds = new Set<string>();

  if (data.length === 0) {
    return { autoExpandedNodeIds, items, matchedRootCount: 0 };
  }

  const pushNode = (
    node: TreeItem,
    level: number,
    path: readonly number[],
    isLastSibling: boolean,
  ) => {
    items.push({
      ...node,
      hasChildren: Boolean(node.children?.length),
      index: items.length,
      isLastSibling,
      level,
      nodeId: nodeIdFor(path),
    });
  };

  if (normalizedQuery !== "") {
    const matchMap = new Map<string, boolean>();
    const computeMatches = (
      node: TreeItem,
      path: readonly number[],
    ): boolean => {
      const nodeId = nodeIdFor(path);
      const selfMatches = nodeMatchesQuery(node, normalizedQuery);
      let childMatches = false;
      node.children?.forEach((child, childIndex) => {
        if (computeMatches(child, [...path, childIndex])) {
          childMatches = true;
        }
      });

      const matches = selfMatches || childMatches;
      matchMap.set(nodeId, matches);
      if (childMatches) {
        autoExpandedNodeIds.add(nodeId);
      }
      return matches;
    };

    let matchedRootCount = 0;
    data.forEach((root, rootIndex) => {
      if (computeMatches(root, [rootIndex])) {
        matchedRootCount += 1;
      }
    });

    const build = (
      node: TreeItem,
      level: number,
      path: readonly number[],
      isLastSibling: boolean,
    ) => {
      const nodeId = nodeIdFor(path);
      if (!matchMap.get(nodeId)) {
        return;
      }

      pushNode(node, level, path, isLastSibling);
      if (!autoExpandedNodeIds.has(nodeId)) {
        return;
      }

      const visibleChildren =
        node.children
          ?.map((child, childIndex) => ({ child, childIndex }))
          .filter(({ childIndex }) =>
            matchMap.get(nodeIdFor([...path, childIndex])),
          ) ?? [];

      visibleChildren.forEach(({ child, childIndex }, visibleIndex) =>
        build(
          child,
          level + 1,
          [...path, childIndex],
          visibleIndex === visibleChildren.length - 1,
        ),
      );
    };

    const visibleRoots = data
      .map((root, rootIndex) => ({ root, rootIndex }))
      .filter(({ rootIndex }) => matchMap.get(nodeIdFor([rootIndex])));
    visibleRoots.forEach(({ root, rootIndex }, visibleIndex) =>
      build(root, 0, [rootIndex], visibleIndex === visibleRoots.length - 1),
    );
    return { autoExpandedNodeIds, items, matchedRootCount };
  }

  const build = (
    node: TreeItem,
    level: number,
    path: readonly number[],
    isLastSibling: boolean,
  ) => {
    pushNode(node, level, path, isLastSibling);
    const nodeId = nodeIdFor(path);
    if (!expandedNodeIds.has(nodeId)) {
      return;
    }

    const children = node.children ?? [];

    children.forEach((child, childIndex) =>
      build(
        child,
        level + 1,
        [...path, childIndex],
        childIndex === children.length - 1,
      ),
    );
  };

  data.forEach((root, rootIndex) =>
    build(root, 0, [rootIndex], rootIndex === data.length - 1),
  );
  return {
    autoExpandedNodeIds,
    items,
    matchedRootCount: data.length,
  };
};

export const toTreeJson = (item: TreeItem): unknown => {
  if (item.raw !== undefined) {
    return item.raw;
  }

  if (item.children?.length) {
    return {
      children: item.children.map(toTreeJson),
      name: item.name,
      ...(item.value === undefined ? {} : { value: item.value }),
    };
  }

  return item.value === undefined
    ? { name: item.name }
    : { name: item.name, value: item.value };
};
