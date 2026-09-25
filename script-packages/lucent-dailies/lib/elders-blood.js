// @ts-check

const api = require("lucent/api");
const script = require("lucent/script");

const QUEST_ID = 802;
const REWARD_ITEM_ID = 5586;
const MONSTER = "Gorillaphant";
const REQUIREMENT = { item: 5574, quantity: 50 };

/** @typedef {{ readonly status: "completed" | "maxed" | "unavailable" | "failed" }} EldersBloodResult */

function* quantity() {
  const inventory = (yield* api.inventory.get(REWARD_ITEM_ID))?.quantity ?? 0;
  const bank = (yield* api.bank.get(REWARD_ITEM_ID))?.quantity ?? 0;
  return inventory + bank;
}

/**
 * Completes the Elders' Blood daily unless the reward is already at its stack limit.
 *
 * @returns {Generator<unknown, EldersBloodResult, unknown>}
 */
function* farmEldersBlood() {
  if (!(yield* api.quests.load(QUEST_ID, true))) return { status: "failed" };
  if (!(yield* api.bank.load())) return { status: "failed" };

  const owned =
    (yield* api.inventory.get(REWARD_ITEM_ID)) ??
    (yield* api.bank.get(REWARD_ITEM_ID));
  const maxStack =
    (yield* api.quests.get(QUEST_ID))?.rewards.find(
      (reward) => reward.itemId === REWARD_ITEM_ID,
    )?.maxStack ?? owned?.maxStack;
  if (owned && maxStack !== undefined && owned.quantity >= maxStack) {
    return { status: "maxed" };
  }

  const available = yield* api.quests.isAvailable(QUEST_ID);
  const inProgress = yield* api.quests.isInProgress(QUEST_ID);
  if (!available && !inProgress) return { status: "unavailable" };

  if (owned?.banked && !(yield* api.bank.withdraw(REWARD_ITEM_ID))) {
    return { status: "failed" };
  }
  const before = yield* quantity();

  if (
    !(yield* api.player.joinMap("arcangrove", {
      cell: "LeftBack",
      pad: "Left",
    }))
  ) {
    return { status: "failed" };
  }
  if (!(yield* api.quests.accept(QUEST_ID))) return { status: "failed" };
  if (!(yield* api.combat.killForTempItem(MONSTER, REQUIREMENT))) {
    return { status: "failed" };
  }
  if (!(yield* api.quests.complete(QUEST_ID))) return { status: "failed" };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      (yield* api.drops.contains(REWARD_ITEM_ID)) &&
      !(yield* api.drops.accept(REWARD_ITEM_ID))
    ) {
      return { status: "failed" };
    }
    if ((yield* quantity()) > before) {
      return { status: "completed" };
    }
    yield* script.sleep("250 millis");
  }
  return { status: "failed" };
}

module.exports = { farmEldersBlood };
