// @ts-check

const api = require("lucent/api");
const script = require("lucent/script");

const QUEST_ID = 802;
const REWARD_NAME = "Elders' Blood";
const MONSTER = "Gorillaphant";
const REQUIREMENT = { item: "Slain Gorillaphant", quantity: 50 };

/** @typedef {{ readonly status: "completed" | "maxed" | "unavailable" | "failed" }} EldersBloodResult */

/** @param {number} itemId */
function* quantity(itemId) {
  return (yield* api.inventory.get(itemId))?.quantity ?? 0;
}

/**
 * Completes the Elders' Blood daily unless the reward is already at its stack limit.
 *
 * @returns {Generator<unknown, EldersBloodResult, unknown>}
 */
function* farmEldersBlood() {
  if (!(yield* api.quests.load(QUEST_ID, true))) return { status: "failed" };
  const reward = (yield* api.quests.get(QUEST_ID))?.rewards.find(
    (candidate) => candidate.name === REWARD_NAME,
  );
  if (reward?.maxStack === undefined) return { status: "failed" };

  const owned =
    (yield* api.inventory.get(reward.itemId)) ??
    (yield* api.bank.get(reward.itemId));
  if ((owned?.quantity ?? 0) >= reward.maxStack) return { status: "maxed" };

  const available = yield* api.quests.isAvailable(QUEST_ID);
  const inProgress = yield* api.quests.isInProgress(QUEST_ID);
  if (!available && !inProgress) return { status: "unavailable" };

  if (owned?.banked && !(yield* api.bank.withdraw(reward.itemId))) {
    return { status: "failed" };
  }
  const before = yield* quantity(reward.itemId);

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
      (yield* api.drops.contains(reward.itemId)) &&
      !(yield* api.drops.accept(reward.itemId))
    ) {
      return { status: "failed" };
    }
    if ((yield* quantity(reward.itemId)) > before) {
      return { status: "completed" };
    }
    yield* script.sleep("250 millis");
  }
  return { status: "failed" };
}

module.exports = { farmEldersBlood };
