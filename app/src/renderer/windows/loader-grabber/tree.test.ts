import type { QuestInfo } from "@lucent/game";
import { expect, test } from "vitest";
import { buildGrabbedDataTree, type TreeItem } from "./tree";

const quest = (data: Record<string, unknown>): QuestInfo =>
  data as unknown as QuestInfo;

const child = (item: TreeItem, name: string): TreeItem | undefined =>
  item.children?.find((candidate) => candidate.name === name);

const childValue = (item: TreeItem, name: string): string | undefined =>
  child(item, name)?.value;

const expectTreeItem = (item: TreeItem | undefined): TreeItem => {
  expect(item).toBeDefined();
  return item as TreeItem;
};

test("builds quest rewards from reward rows and oRewards metadata", () => {
  const tree = buildGrabbedDataTree("quest", [
    quest({
      QuestID: "446",
      RequiredItems: [],
      Rewards: [],
      oItems: {},
      reward: [
        {
          iRate: "2.00",
          ItemID: "2476",
          iQty: "1",
          iType: "1",
        },
      ],
      oRewards: {
        itemsR: {
          "0": {
            ItemID: "2476",
            iQty: 1,
            sName: "Shark Bait's Armor",
          },
        },
      },
      sName: "Chest Thumping",
    }),
  ]);

  const questTree = expectTreeItem(tree[0]);
  const rewards = child(questTree, "Rewards");
  const reward = rewards?.children?.[0];

  expect(reward?.name).toBe("Shark Bait's Armor");
  expect(reward ? childValue(reward, "ID") : undefined).toBe("2476");
  expect(reward ? childValue(reward, "Quantity") : undefined).toBe("1");
  expect(reward ? childValue(reward, "Drop chance") : undefined).toBe(
    "2.00%",
  );
});

test("builds quest requirements from turnin rows and oItems metadata", () => {
  const tree = buildGrabbedDataTree("quest", [
    quest({
      QuestID: "446",
      RequiredItems: [],
      Rewards: [],
      oItems: {
        "2570": {
          ItemID: 2570,
          bTemp: true,
          iQty: 0,
          sDesc: " ",
          sName: "Muck Covered Chest",
        },
      },
      oRewards: {},
      reward: [],
      sName: "Chest Thumping",
      turnin: [
        {
          iQty: "1",
          ItemID: "2570",
        },
      ],
    }),
  ]);

  const questTree = expectTreeItem(tree[0]);
  const requiredItems = child(questTree, "Required Items");
  const requiredItem = requiredItems?.children?.[0];

  expect(requiredItem?.name).toBe("Muck Covered Chest");
  expect(requiredItem ? childValue(requiredItem, "Quantity") : undefined).toBe(
    "1",
  );
  expect(requiredItem ? childValue(requiredItem, "Temporary") : undefined).toBe(
    "Yes",
  );
  expect(child(requiredItem ?? { name: "missing" }, "Description")).toBeUndefined();
});

test("omits empty quest item sections", () => {
  const tree = buildGrabbedDataTree("quest", [
    quest({
      QuestID: "1",
      RequiredItems: [],
      Rewards: [],
      oItems: {},
      oRewards: {},
      reward: [],
      sDesc: " ",
      sName: "Empty Quest",
      turnin: [],
    }),
  ]);

  const questTree = expectTreeItem(tree[0]);

  expect(child(questTree, "Description")).toBeUndefined();
  expect(child(questTree, "Required Items")).toBeUndefined();
  expect(child(questTree, "Rewards")).toBeUndefined();
});
