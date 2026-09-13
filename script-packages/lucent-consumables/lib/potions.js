// @ts-check

/** @typedef {import("./types").PotionRecipe} PotionRecipe */
/** @typedef {import("./types").Session} Session */

const api = require("lucent/api");
const script = require("lucent/script");
const { materials } = require("./catalog");
const { acquire, materialSource } = require("./supplies");
const { quantity, unbank, acceptDrop } = require("./inventory");
const { collectRewards } = require("./rewards");

/** @param {string} name
 * @param {PotionRecipe} recipe
 * @param {Session} session */
function* craft(name, recipe, session) {
  if (!(yield* api.player.joinMap("alchemy")))
    throw new Error("Could not reach alchemy.");
  /** @type {Map<number, string | null>} */
  const rewards = new Map();
  const dispose = yield* api.packet.on(
    {
      direction: "extension",
      predicate: (packet) =>
        ["dropItem", "addItems", "forceAddItem"].includes(packet.command),
    },
    // eslint-disable-next-line require-yield -- Script callbacks must return an Effect or generator.
    function* (packet) {
      collectRewards(packet.data, rewards);
    },
  );
  try {
    yield* completeCraft(name, recipe, rewards, session);
  } finally {
    dispose();
  }
}

/** @param {string} name
 * @param {PotionRecipe} recipe
 * @param {Map<number, string | null>} rewards
 * @param {Session} session */
function* completeCraft(name, recipe, rewards, session) {
  if (!recipe.reagents) throw new Error(`${name} has no alchemy recipe.`);
  const [first, second] = recipe.reagents.map((reagent) => materials[reagent]);
  const before = yield* quantity(first.item);
  const beforeSecond = yield* quantity(second.item);
  const beforeRune = yield* quantity("Dragon Runestone");
  const beforeTarget = yield* quantity(name);
  const args = `${first.item}%${second.item}%true%`;
  const traits = `${first.name}%${second.name}%${recipe.rune}%${recipe.trait}%`;
  const started = yield* api.packet.once(
    {
      direction: "extension",
      predicate: (packet) =>
        packet.command === "alchOnStart" || packet.command === "alchError",
    },
    {
      timeout: "10 seconds",
      trigger: api.packet.sendToServer(
        `%xt%zm%crafting%1%getAlchWait%${args}Ready to Mix%${traits}`,
      ),
    },
  );
  if (!started || started.command === "alchError")
    throw new Error(`Alchemy did not start for ${name}.`);
  // Start confirmation can precede the server's next allowed action.
  yield* script.sleep("1400 millis");
  const completed = yield* api.packet.once(
    {
      direction: "extension",
      predicate: (packet) =>
        packet.command === "alchComplete" ||
        packet.command === "alchOnComplete" ||
        packet.command === "alchError",
    },
    {
      timeout: "10 seconds",
      trigger: api.packet.sendToServer(
        `%xt%zm%crafting%1%checkAlchComplete%${args}Mix Complete%${traits}`,
      ),
    },
  );
  if (!completed || completed.command === "alchError") {
    throw new Error(
      `Alchemy did not confirm completion for ${name}. Stopping without repeating the craft.`,
    );
  }
  yield* script.sleep("1400 millis");
  // Completion and inventory updates can arrive in separate packets.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    yield* unbank(name);
    yield* acceptDrop(name);
    if (
      (yield* quantity(first.item)) < before &&
      (yield* quantity(second.item)) < beforeSecond &&
      (yield* quantity("Dragon Runestone")) < beforeRune
    ) {
      if ((yield* quantity(name)) > beforeTarget) return;
      for (const [itemId, packetName] of rewards) {
        const rewardName =
          packetName ??
          (yield* api.inventory.get(itemId))?.name ??
          (yield* api.bank.get(itemId))?.name;
        if (
          rewardName &&
          rewardName.trim().toLowerCase() !== name.trim().toLowerCase()
        ) {
          if (session.wanted.has(rewardName.trim().toLowerCase())) {
            yield* unbank(rewardName);
            yield* acceptDrop(rewardName);
          }
          yield* script.log(
            `Alchemy produced ${rewardName}. Still waiting for ${name}.`,
          );
          return;
        }
      }
    }
    yield* script.sleep("250 millis");
  }
  throw new Error(
    `Alchemy did not deliver a confirmed reward for ${name}. Stopping without repeating the craft.`,
  );
}

/** @param {string} name
 * @param {PotionRecipe} recipe
 * @param {number} target
 * @param {Session} session */
function* preparePotion(name, recipe, target, session) {
  if (target > recipe.maxStack)
    yield* script.log(
      `${name} stacks to ${recipe.maxStack}. Using that target.`,
    );
  target = Math.min(target, recipe.maxStack);
  yield* unbank(name);
  yield* acceptDrop(name);
  if ((yield* quantity(name)) >= target) {
    yield* script.log(`${name}: already have ${target}.`);
    return;
  }
  if (!recipe.reagents || session.potionMethod === "buy") {
    yield* script.log(`Buying ${name} to ${target}.`);
    return {
      target,
      goal: { source: { ...recipe.purchase, item: name }, quantity: target },
    };
  }
  if (((yield* api.player.factions.get("Alchemy"))?.rank ?? 0) < 10) {
    throw new Error(`Reach Alchemy rank 10 before crafting ${name}.`);
  }
  return { target };
}

/** @param {string} name
 * @param {PotionRecipe} recipe
 * @param {number} target
 * @param {Session} session */
function* ensurePotion(name, recipe, target, session) {
  if (!recipe.reagents) return;
  while ((yield* quantity(name)) < target) {
    if (session.crafts >= session.maxCrafts)
      throw new Error(
        `Reached the limit of ${session.maxCrafts} alchemy attempts. ${name} is still below ${target}.`,
      );
    /** @type {import("./types").Goal[]} */
    const goals = [];
    for (const reagent of recipe.reagents) {
      let source = materialSource(materials[reagent].item, session.mode);
      if (source.memberOnly && !(yield* api.player.isMember())) {
        yield* script.log(
          `${reagent} requires membership to farm. Buying it instead.`,
        );
        source = materialSource(materials[reagent].item, "buy");
      } else if (session.mode === "farm" && !source.farm) {
        yield* script.log(`${reagent} has no farm route. Buying it if needed.`);
      }
      goals.push({ source, quantity: 1 });
    }
    goals.push({
      source: materialSource("Dragon Runestone", "buy"),
      quantity: 1,
    });
    yield* acquire(goals, session);
    yield* script.log(`Crafting ${name}, attempt ${session.crafts + 1}.`);
    yield* craft(name, recipe, session);
    session.crafts += 1;
    yield* script.log(
      `${name}: ${yield* quantity(name)}/${target}. Gold spent: ${session.spent.toLocaleString()}.`,
    );
  }
}

module.exports = { preparePotion, ensurePotion };
