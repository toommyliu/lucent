import type { ItemQuery, ShopItemQuery } from "@lucent/game";
import * as Effect from "effect/Effect";

import type { ScriptRecipeDependencies } from "./Dependencies";

const LIFE_STEAL = "Scroll of Life Steal";
const SCROLL_OF_ENRAGE = "Scroll of Enrage";
const GOLD_VOUCHER = "Gold Voucher 100k";
const ARCANE_QUILL = "Arcane Quill";
const ZEALOUS_INK = "Zealous Ink";

const GOLD_VOUCHER_SELECTOR = {
  shopItemId: 7_681,
} as const satisfies ShopItemQuery;
const ARCANE_QUILL_SELECTOR = {
  shopItemId: 7_685,
} as const satisfies ShopItemQuery;
const ZEALOUS_INK_SELECTOR = {
  shopItemId: 10_371,
} as const satisfies ShopItemQuery;

const SCROLL_OF_ENRAGE_QUEST_ID = 2_330;
const SCROLL_REWARD_QUANTITY = 40;
const ZEALOUS_INK_SHOP_QUANTITY = 5;

const normalizeQuantity = (
  quantity: number,
  maximum: number,
): number | undefined =>
  Number.isFinite(quantity)
    ? Math.min(maximum, Math.max(1, Math.floor(quantity)))
    : undefined;

const inventoryQuantity = Effect.fn("ScriptRecipes.inventoryQuantity")(
  function* (deps: ScriptRecipeDependencies, item: ItemQuery) {
    return (yield* deps.inventory.get(item))?.quantity ?? 0;
  },
);

const buyToQuantity = Effect.fn("ScriptRecipes.buyToQuantity")(function* (
  deps: ScriptRecipeDependencies,
  inventoryItem: ItemQuery,
  shopItem: ShopItemQuery,
  targetQuantity: number,
) {
  let current = yield* inventoryQuantity(deps, inventoryItem);
  while (current < targetQuantity) {
    const maximum = yield* deps.shops.getMaxBuyQuantity(shopItem);
    const requested = Math.min(targetQuantity - current, maximum);
    if (requested <= 0) return false;
    if (!(yield* deps.shops.buy(shopItem, { quantity: requested }))) {
      return false;
    }
    const updated = yield* inventoryQuantity(deps, inventoryItem);
    if (updated <= current) return false;
    current = updated;
  }
  return true;
});

const ensureGoldVouchers = Effect.fn("ScriptRecipes.ensureGoldVouchers")(
  function* (deps: ScriptRecipeDependencies, targetQuantity: number) {
    return yield* buyToQuantity(
      deps,
      GOLD_VOUCHER,
      GOLD_VOUCHER_SELECTOR,
      targetQuantity,
    );
  },
);

const ensureArcaneQuills = Effect.fn("ScriptRecipes.ensureArcaneQuills")(
  function* (deps: ScriptRecipeDependencies, targetQuantity: number) {
    const current = yield* inventoryQuantity(deps, ARCANE_QUILL);
    const missing = Math.max(0, targetQuantity - current);
    if (missing === 0) return true;
    if (!(yield* ensureGoldVouchers(deps, missing))) {
      return false;
    }
    return yield* buyToQuantity(
      deps,
      ARCANE_QUILL,
      ARCANE_QUILL_SELECTOR,
      targetQuantity,
    );
  },
);

const ensureZealousInk = Effect.fn("ScriptRecipes.ensureZealousInk")(function* (
  deps: ScriptRecipeDependencies,
  targetQuantity: number,
) {
  const current = yield* inventoryQuantity(deps, ZEALOUS_INK);
  const missing = Math.max(0, targetQuantity - current);
  if (missing === 0) return true;
  const requested =
    Math.ceil(missing / ZEALOUS_INK_SHOP_QUANTITY) * ZEALOUS_INK_SHOP_QUANTITY;
  const quills = Math.ceil(requested / ZEALOUS_INK_SHOP_QUANTITY);
  if (!(yield* ensureArcaneQuills(deps, quills))) {
    return false;
  }
  if (
    !(yield* deps.shops.buy(ZEALOUS_INK_SELECTOR, {
      quantity: requested,
    }))
  ) {
    return false;
  }
  const after = yield* inventoryQuantity(deps, ZEALOUS_INK);
  return after >= targetQuantity;
});

const acceptEnrageDrop = Effect.fn("ScriptRecipes.acceptEnrageDrop")(function* (
  deps: ScriptRecipeDependencies,
) {
  if (!(yield* deps.drops.contains(SCROLL_OF_ENRAGE))) return false;
  return yield* deps.drops.accept(SCROLL_OF_ENRAGE);
});

const waitForEnrageQuantity = Effect.fn("ScriptRecipes.waitForEnrageQuantity")(
  function* (deps: ScriptRecipeDependencies, quantity: number) {
    return yield* deps.wait.until(
      Effect.gen(function* () {
        yield* acceptEnrageDrop(deps);
        return yield* deps.inventory.contains(SCROLL_OF_ENRAGE, quantity);
      }),
      { interval: "250 millis", timeout: "7 seconds" },
    );
  },
);

const abandonEnrageQuest = Effect.fn("ScriptRecipes.abandonEnrageQuest")(
  function* (deps: ScriptRecipeDependencies) {
    if (!(yield* deps.quests.isInProgress(SCROLL_OF_ENRAGE_QUEST_ID))) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (yield* deps.quests.isInProgress(SCROLL_OF_ENRAGE_QUEST_ID)) {
        yield* deps.quests.abandon(SCROLL_OF_ENRAGE_QUEST_ID);
      }
      yield* Effect.sleep("250 millis");
    }
  },
);

export const ensureLifeSteal = Effect.fn("ScriptRecipes.ensureLifeSteal")(
  function* (deps: ScriptRecipeDependencies, quantity: number) {
    const targetQuantity = normalizeQuantity(quantity, 99);
    if (targetQuantity === undefined) return false;

    yield* deps.bank.withdraw(LIFE_STEAL);
    if (yield* deps.inventory.contains(LIFE_STEAL, targetQuantity)) return true;
    if (
      !(yield* deps.player.joinMap("arcangrove", {
        cell: "Potion",
        pad: "Right",
      }))
    ) {
      return false;
    }
    if (!(yield* deps.shops.load(211))) return false;
    return yield* buyToQuantity(deps, LIFE_STEAL, LIFE_STEAL, targetQuantity);
  },
);

export const ensureScrollOfEnrage = Effect.fn(
  "ScriptRecipes.ensureScrollOfEnrage",
)(function* (deps: ScriptRecipeDependencies, quantity: number) {
  const targetQuantity = normalizeQuantity(quantity, 1_000);
  if (targetQuantity === undefined) return false;

  yield* deps.bank.withdrawBatch([
    GOLD_VOUCHER,
    ARCANE_QUILL,
    ZEALOUS_INK,
    SCROLL_OF_ENRAGE,
  ]);
  if (yield* deps.inventory.contains(SCROLL_OF_ENRAGE, targetQuantity)) {
    return true;
  }
  if (!(yield* deps.player.joinMap("spellcraft"))) {
    return false;
  }
  if (!(yield* deps.shops.load(693))) {
    return false;
  }

  let questAcquired = false;
  return yield* Effect.gen(function* () {
    while (
      !(yield* deps.inventory.contains(SCROLL_OF_ENRAGE, targetQuantity))
    ) {
      yield* acceptEnrageDrop(deps);
      if (yield* deps.inventory.contains(SCROLL_OF_ENRAGE, targetQuantity)) {
        return true;
      }
      const alreadyAccepted = yield* deps.quests.isInProgress(
        SCROLL_OF_ENRAGE_QUEST_ID,
      );
      if (!(yield* deps.quests.accept(SCROLL_OF_ENRAGE_QUEST_ID, true))) {
        return false;
      }
      if (!alreadyAccepted) questAcquired = true;
      if (!(yield* ensureZealousInk(deps, 1))) {
        return false;
      }
      if (!(yield* deps.quests.canComplete(SCROLL_OF_ENRAGE_QUEST_ID))) {
        return false;
      }
      const before = yield* inventoryQuantity(deps, SCROLL_OF_ENRAGE);
      const neededTurnIns = Math.max(
        1,
        Math.ceil((targetQuantity - before) / SCROLL_REWARD_QUANTITY),
      );
      const maximumTurnIns = yield* deps.quests.getMaxTurnIns(
        SCROLL_OF_ENRAGE_QUEST_ID,
      );
      const turnIns = Math.min(neededTurnIns, maximumTurnIns);
      if (!(yield* deps.quests.complete(SCROLL_OF_ENRAGE_QUEST_ID, turnIns))) {
        return false;
      }
      const expected = Math.min(
        targetQuantity,
        before + turnIns * SCROLL_REWARD_QUANTITY,
      );
      if (!(yield* waitForEnrageQuantity(deps, expected))) {
        return false;
      }
    }
    return true;
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() =>
        questAcquired ? abandonEnrageQuest(deps) : Effect.void,
      ),
    ),
  );
});
