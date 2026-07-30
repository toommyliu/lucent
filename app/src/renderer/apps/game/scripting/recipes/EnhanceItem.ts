import {
  matchesAppliedEnhancement,
  matchesEnhancementShopItem,
  resolveEnhancementStrategy,
  toItemSelector,
} from "@lucent/game";
import type { Item, ItemQuery } from "@lucent/game";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { Packet } from "../../flash/contract/Packet";
import type { ScriptEnhanceItemOptions } from "../ScriptApi";
import type { ScriptRecipeDependencies } from "./Dependencies";

const enhancementResponseContains = (packet: Packet, itemId: number) => {
  if (packet.direction === "client" || typeof packet.data !== "object") {
    return false;
  }
  const itemIds = (packet.data as { readonly ItemIDs?: unknown }).ItemIDs;
  return (
    Array.isArray(itemIds) && itemIds.some((value) => Number(value) === itemId)
  );
};

const candidateOrder = (member: boolean) => (left: Item, right: Item) => {
  const levelDifference =
    (right.enhancement?.level ?? 0) - (left.enhancement?.level ?? 0);
  if (levelDifference !== 0) return levelDifference;
  if (member && left.memberOnly !== right.memberOnly) {
    return (
      Number(right.memberOnly === member) - Number(left.memberOnly === member)
    );
  }
  return (left.shopItemId ?? left.itemId) - (right.shopItemId ?? right.itemId);
};

const selectorForCandidate = (candidate: Item) =>
  candidate.shopItemId === undefined
    ? { itemId: candidate.itemId }
    : { shopItemId: candidate.shopItemId };

export const enhanceItem = Effect.fn("ScriptRecipes.enhanceItem")(function* (
  deps: ScriptRecipeDependencies,
  item: ItemQuery,
  options: ScriptEnhanceItemOptions,
) {
  const itemSelector = toItemSelector(item);
  const { enhancement, special } = options;

  const inventoryItem = yield* deps.inventory.get(itemSelector);
  if (inventoryItem === null) {
    return false;
  }

  const playerLevel = yield* deps.player.getLevel();
  const strategyResolution = resolveEnhancementStrategy(
    inventoryItem,
    enhancement,
    playerLevel,
    special,
  );
  if (!strategyResolution.ok) {
    return false;
  }
  const strategy = strategyResolution.strategy;

  const matchesApplied = matchesAppliedEnhancement(inventoryItem, strategy);
  const appliedLevel = matchesApplied
    ? inventoryItem.enhancement?.level
    : undefined;
  if (appliedLevel !== undefined && appliedLevel >= playerLevel) {
    return true;
  }

  if (strategy.map !== undefined) {
    const joined = yield* deps.player.joinMap(strategy.map);
    if (!joined) return false;
  }

  const loaded = yield* deps.shops.load(strategy.shopId);
  if (!loaded) return false;

  const member = yield* deps.player.isMember();
  const shopItems = yield* deps.shops.getAll();
  const candidates = shopItems
    .filter(
      (candidate) =>
        (!candidate.memberOnly || member) &&
        candidate.enhancement?.level !== undefined &&
        candidate.enhancement.level <= playerLevel &&
        matchesEnhancementShopItem(candidate, strategy),
    )
    .toSorted(candidateOrder(member));

  let candidateSelector: ReturnType<typeof selectorForCandidate> | undefined;
  for (const current of candidates) {
    const candidateLevel = current.enhancement?.level ?? 0;
    if (appliedLevel !== undefined && appliedLevel >= candidateLevel) {
      return true;
    }
    const selector = selectorForCandidate(current);
    const canBuy = yield* deps.shops.canBuy(selector);
    if (!canBuy) continue;
    candidateSelector = selector;
    break;
  }
  if (candidateSelector === undefined) {
    return false;
  }

  const actionAvailable = yield* deps.wait.forGameAction("buyItem");
  if (!actionAvailable) return false;

  const response = yield* deps.wait.forPacket(
    {
      command: "enhanceItemShop",
      direction: "extension",
      predicate: (packet) =>
        enhancementResponseContains(packet, inventoryItem.itemId),
      wireType: "json",
    },
    {
      timeout: "5 seconds",
      trigger: Effect.gen(function* () {
        const bridgeResult = yield* deps.bridge.invoke(
          "shops.enhance",
          [candidateSelector, inventoryItem.itemId],
          Schema.Boolean,
        );
        const triggered = Option.getOrElse(bridgeResult, () => false);
        return triggered;
      }),
    },
  );
  if (response === null) {
    return false;
  }

  const updated = yield* deps.inventory.get(inventoryItem.itemId);
  const applied =
    updated !== null && matchesAppliedEnhancement(updated, strategy);
  return applied;
});
