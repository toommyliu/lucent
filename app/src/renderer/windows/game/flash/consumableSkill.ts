import type { Item } from "@lucent/game";
import { Effect } from "effect";
import type { CombatShape } from "./Services/Combat";
import type { WaitShape } from "./Services/Wait";
import type { ConsumableSkillItem } from "./Types";

export const CONSUMABLE_SKILL_INDEX = 5;

const normalizeConsumableName = (name: string): string =>
  name.trim().toLowerCase().replaceAll(/\s+/g, " ");

export const consumableSkillItemMatches = (
  consumableSkillItem: ConsumableSkillItem | null,
  expectedItem: Item,
): boolean => {
  if (!consumableSkillItem) {
    return false;
  }

  if (consumableSkillItem.itemId !== undefined) {
    return consumableSkillItem.itemId === expectedItem.id;
  }

  if (consumableSkillItem.name !== undefined) {
    return (
      normalizeConsumableName(consumableSkillItem.name) ===
      normalizeConsumableName(expectedItem.name)
    );
  }

  return false;
};

export const waitForConsumableSkillSlot = (
  deps: Pick<{ combat: CombatShape; wait: WaitShape }, "combat" | "wait">,
  expectedItem: Item,
) =>
  deps.wait.until(
    Effect.map(deps.combat.getConsumableSkillItem(), (consumableSkillItem) =>
      consumableSkillItemMatches(consumableSkillItem, expectedItem),
    ),
    { timeout: "2 seconds" },
  );
