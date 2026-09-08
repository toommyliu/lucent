// @ts-check

const api = require("lucent/api");
const script = require("lucent/script");
const { collect, acceptDrop, quantity, unbank } = require("./inventory");

/** @param {number} questId
 * @param {number} target
 * @param {import("./types").Session} session
 * @returns {Generator<unknown, import("./types").Goal | undefined, unknown>} */
function* prepareScroll(questId, target, session) {
  if (!(yield* api.quests.load(questId, true)))
    throw new Error(`Could not load scroll quest ${questId}.`);
  const quest = yield* api.quests.get(questId);
  if (!quest || quest.rewards.length !== 1 || quest.requirements.length !== 1) {
    throw new Error(`Scroll quest ${questId} has an unsupported recipe.`);
  }
  const reward = quest.rewards[0];
  const ink = quest.requirements[0];
  if (!reward.maxStack)
    throw new Error(`The stack limit for ${reward.name} is unavailable.`);
  if (target > reward.maxStack)
    yield* script.log(
      `${reward.name} stacks to ${reward.maxStack}. Using that target.`,
    );
  target = Math.min(target, reward.maxStack);
  yield* unbank(reward.itemId, reward.name);
  yield* acceptDrop(reward.itemId);
  if ((yield* quantity(reward.itemId)) >= target) {
    yield* script.log(`${reward.name}: already have ${target}.`);
    return;
  }
  if (
    !(yield* api.quests.isInProgress(questId)) &&
    !(yield* api.quests.isAvailable(questId))
  ) {
    throw new Error(
      `${reward.name} is locked. Complete its SpellCrafting reputation and quest requirements first.`,
    );
  }
  yield* script.log(
    `Getting ${reward.name} to ${target} using ${session.mode === "farm" ? "farmed" : "purchased"} ink ingredients.`,
  );
  return {
    source: {
      item: reward.itemId,
      name: reward.name,
      map: "spellcraft",
      shop: session.mode === "farm" ? 549 : 622,
      scroll: { questId, reward, ink, maxStack: reward.maxStack },
    },
    quantity: target,
  };
}

/** @param {import("./types").ScrollRecipe & { readonly target: number }} prepared */
function* ensureScroll({ questId, reward, target }) {
  if (!(yield* api.player.joinMap("spellcraft")))
    throw new Error("Could not reach spellcraft.");
  const alreadyAccepted = yield* api.quests.isInProgress(questId);
  try {
    while ((yield* quantity(reward.itemId)) < target) {
      if (!(yield* api.quests.accept(questId, true)))
        throw new Error(`Could not accept ${reward.name}.`);
      const before = yield* quantity(reward.itemId);
      if (
        !(yield* api.quests.canComplete(questId)) ||
        !(yield* api.quests.complete(questId, { turnIns: 1 }))
      ) {
        throw new Error(`Could not complete ${reward.name}.`);
      }
      if (
        !(yield* collect(
          reward.itemId,
          Math.min(target, before + reward.quantity),
        ))
      ) {
        throw new Error(
          `${reward.name} did not arrive after the quest turn-in. Stopping without repeating it.`,
        );
      }
      yield* script.log(
        `${reward.name}: ${yield* quantity(reward.itemId)}/${target}.`,
      );
    }
  } finally {
    if (!alreadyAccepted && (yield* api.quests.isInProgress(questId)))
      yield* api.quests.abandon(questId);
  }
}

module.exports = { prepareScroll, ensureScroll };
