// @ts-check

const api = require("lucent/api");

const DAILY_QUEST_ID = 3075;
const DAILY_XP_BOOST_ITEM_ID = 19189;
const GEAR_OF_DOOM_ITEM_ID = 45739;
const WEEKLY_QUEST_ID = 3076;

/** @typedef {{ readonly bankRewards?: boolean }} WheelOfDoomOptions */
/** @typedef {{ readonly status: "unavailable" } | { readonly status: "failed" } | { readonly status: "completed", readonly banking: "not-requested" | "completed" | "failed" }} WheelOfDoomSpinOutcome */
/** @typedef {{ readonly daily: WheelOfDoomSpinOutcome, readonly weekly: WheelOfDoomSpinOutcome }} WheelOfDoomResult */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value */
const rewardName = (value) => {
  if (!isRecord(value)) return undefined;
  const name = value["sName"];
  return typeof name === "string" && name !== "" ? name : undefined;
};

/** @param {unknown} packet */
const wheelRewardNames = (packet) => {
  if (!isRecord(packet) || packet["direction"] !== "extension") return [];
  const data = packet["data"];
  if (!isRecord(data)) return [];

  /** @type {Set<string>} */
  const rewards = new Set();
  const dropItems = data["dropItems"];
  if (isRecord(dropItems)) {
    const boost = rewardName(dropItems[String(DAILY_XP_BOOST_ITEM_ID)]);
    if (boost !== undefined) rewards.add(boost);
  }
  const optionalReward = rewardName(data["Item"]);
  if (optionalReward !== undefined) rewards.add(optionalReward);
  return Array.from(rewards);
};

/**
 * @param {number} questId
 * @param {boolean} bankRewards
 * @returns {Generator<unknown, WheelOfDoomSpinOutcome, unknown>}
 */
function* completeWheelQuest(questId, bankRewards) {
  if (!(yield* api.quests.load(questId, true))) return { status: "failed" };
  const available = yield* api.quests.isAvailable(questId);
  const inProgress = yield* api.quests.isInProgress(questId);
  if (!available && !inProgress) return { status: "unavailable" };
  if (!(yield* api.player.joinMap("doom"))) return { status: "failed" };
  if (!(yield* api.quests.accept(questId))) return { status: "failed" };
  if (!(yield* api.quests.canComplete(questId))) return { status: "failed" };

  if (!bankRewards) {
    return (yield* api.quests.complete(questId))
      ? { status: "completed", banking: "not-requested" }
      : { status: "failed" };
  }

  const packet = yield* api.packet.once(
    { command: "Wheel", direction: "extension", encoding: "json" },
    {
      timeout: "5 seconds",
      trigger: api.quests.complete(questId),
    },
  );
  if (packet === null) return { status: "failed" };

  /** @type {string[]} */
  const toDeposit = [];
  for (const reward of wheelRewardNames(packet)) {
    if ((yield* api.inventory.get(reward)) !== null) {
      toDeposit.push(reward);
    } else if (!(yield* api.bank.contains(reward))) {
      return { status: "completed", banking: "failed" };
    }
  }
  if (
    toDeposit.length > 0 &&
    !(yield* api.bank.depositBatch(toDeposit)).every(Boolean)
  ) {
    return { status: "completed", banking: "failed" };
  }
  return { status: "completed", banking: "completed" };
}

/**
 * Attempts the member-daily spin, then the three-Gear weekly spin.
 *
 * @param {WheelOfDoomOptions} [options]
 * @returns {Generator<unknown, WheelOfDoomResult, unknown>}
 */
function* spinWheelOfDoom(options = {}) {
  /** @type {WheelOfDoomSpinOutcome} */
  let daily = { status: "unavailable" };
  if (yield* api.player.isMember()) {
    daily = yield* completeWheelQuest(
      DAILY_QUEST_ID,
      options.bankRewards === true,
    );
  }

  /** @type {WheelOfDoomSpinOutcome} */
  let weekly = { status: "unavailable" };
  if (!(yield* api.inventory.contains(GEAR_OF_DOOM_ITEM_ID, 3))) {
    yield* api.bank.withdraw(GEAR_OF_DOOM_ITEM_ID);
  }
  if (yield* api.inventory.contains(GEAR_OF_DOOM_ITEM_ID, 3)) {
    weekly = yield* completeWheelQuest(
      WEEKLY_QUEST_ID,
      options.bankRewards === true,
    );
  }

  return { daily, weekly };
}

module.exports = { spinWheelOfDoom };
