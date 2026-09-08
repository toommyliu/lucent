// @ts-check

/** @typedef {import("./types").Source} Source */
/** @typedef {import("./types").Goal} Goal */
/** @typedef {import("./types").Session} Session */
/** @typedef {NonNullable<ReturnType<typeof snapshotOffer>>} Offer */
/** @typedef {{ source: Source, target: number } | { scroll: import("./types").ScrollRecipe, target: number } | { source: Source, info: Offer, units: number }} Step */

const api = require("lucent/api");
const script = require("lucent/script");
const { materials } = require("./catalog");
const { quantity, unbank, acceptDrop } = require("./inventory");
const { ensureScroll } = require("./scrolls");

/** @param {import("./types").ShopLocation} source */
function* open(source) {
  if (!(yield* api.player.joinMap(source.map))) {
    throw new Error(
      `Could not reach ${source.map}. Check the map's access requirements.`,
    );
  }
  if (!(yield* api.shop.open(source.shop))) {
    throw new Error(`Could not open shop ${source.shop} in ${source.map}.`);
  }
}

/** @param {string | number} item
 * @param {"buy" | "farm"} mode
 * @returns {Source} */
function materialSource(item, mode) {
  const source =
    Object.values(materials).find((entry) => entry.item === item) ??
    materials[item];
  if (!source)
    throw new Error(`No ingredient source is registered for ${item}.`);
  return mode === "farm" && source.farm
    ? { ...source, ...source.farm, farm: true }
    : { ...source, farm: false };
}

/** @param {Source} source */
function* findOffer(source) {
  if (source.batchQuantity === undefined) {
    return yield* api.shop.get(source.item);
  }
  const candidates = (yield* api.shop.getAll()).filter(
    (item) =>
      (typeof source.item === "number"
        ? item.itemId === source.item
        : item.name.trim().toLowerCase() ===
          source.item.trim().toLowerCase()) &&
      item.quantity === source.batchQuantity,
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one ${source.batchQuantity}-item offer for ${source.name || source.item} in shop ${source.shop}; found ${candidates.length}.`,
    );
  }
  return candidates[0];
}

/** @param {LiveItem | null} item */
function snapshotOffer(item) {
  if (!item || item.shopItemId === undefined || item.maxStack === undefined)
    return null;
  return {
    itemId: item.itemId,
    shopItemId: item.shopItemId,
    name: item.name,
    cost: item.cost,
    coins: item.coins,
    maxStack: item.maxStack,
    quantity: item.requirements.length > 0 ? item.quantity : 1,
    requirements: item.requirements.map((requirement) => ({ ...requirement })),
  };
}

/** Plans all merge dependencies before spending, reserving shared stock once.
 * @param {readonly Goal[]} goals
 * @param {Session} session
 * @returns {Generator<unknown, void, unknown>}
 */
function* acquire(goals, session) {
  /** @type {Map<string | number, number>} */
  const stock = new Map();
  /** @type {Map<string | number, number>} */
  const held = new Map();
  /** @type {Step[]} */
  const steps = [];
  /** @type {Map<string, Offer>} */
  const offers = new Map();
  const visiting = new Set();
  let cost = 0;

  /** @param {Source} source
   * @param {number} amount
   * @returns {Generator<unknown, void, unknown>} */
  function* reserve(source, amount) {
    const item = source.item;
    if (!stock.has(item)) {
      yield* unbank(item, source.name);
      yield* acceptDrop(item);
      stock.set(item, yield* quantity(item));
    }
    const owned = stock.get(item) ?? 0;
    const physical = owned + (held.get(item) ?? 0);
    const missing = Math.max(0, amount - owned);
    if (missing > 0) {
      if (visiting.has(item))
        throw new Error(`Circular ingredient recipe for ${item}.`);
      visiting.add(item);
      if (source.scroll) {
        const { reward, ink } = source.scroll;
        const units = Math.min(
          Math.ceil(missing / reward.quantity) * reward.quantity,
          source.scroll.maxStack - physical,
        );
        if (units < missing)
          throw new Error(`${reward.name} would exceed its stack limit.`);
        yield* reserve(
          {
            item: ink.itemId,
            name: ink.name,
            map: source.map,
            shop: source.shop,
          },
          ink.quantity * Math.ceil(units / reward.quantity),
        );
        steps.push({ scroll: source.scroll, target: physical + units });
        stock.set(item, owned + units);
      } else if (source.farm === true) {
        steps.push({ source, target: physical + missing });
        stock.set(item, owned + missing);
      } else {
        const offerKey = JSON.stringify([
          source.map,
          source.shop,
          source.item,
          source.batchQuantity,
        ]);
        let info = offers.get(offerKey);
        if (!info) {
          yield* script.log(
            `Checking ${source.name ?? source.item} in shop ${source.shop}.`,
          );
          yield* open(source);
          info = snapshotOffer(yield* findOffer(source)) ?? undefined;
          if (info) offers.set(offerKey, info);
        }
        if (!info)
          throw new Error(
            `Could not read the purchase recipe for ${item} in shop ${source.shop}.`,
          );
        if (info.coins && info.cost > 0)
          throw new Error(
            `The recipe for ${info.name} costs AdventureCoins. Only gold purchases are supported.`,
          );
        if (amount + (held.get(item) ?? 0) > info.maxStack) {
          throw new Error(
            `${info.name} would exceed its stack limit of ${info.maxStack}. Request a smaller quantity.`,
          );
        }
        const units = Math.min(
          Math.ceil(missing / info.quantity) * info.quantity,
          info.maxStack - physical,
        );
        const batches = Math.ceil(units / info.quantity);
        for (const requirement of info.requirements) {
          let dependency = Object.values(materials).find(
            (entry) => entry.item === requirement.itemId,
          );
          if (!dependency) dependency = materials[requirement.name];
          const dependencySource = dependency
            ? materialSource(dependency.item, session.mode)
            : {
                item: requirement.itemId,
                name: requirement.name,
                map: source.map,
                shop: source.shop,
              };
          yield* reserve(dependencySource, requirement.quantity * batches);
        }
        cost += info.cost * units;
        steps.push({ source, info, units });
        stock.set(item, owned + units);
      }
      visiting.delete(item);
    }
    stock.set(item, (stock.get(item) ?? 0) - amount);
  }

  for (const goal of goals) {
    yield* reserve(goal.source, goal.quantity);
    held.set(
      goal.source.item,
      (held.get(goal.source.item) ?? 0) + goal.quantity,
    );
  }
  const gold = yield* api.player.getGold();
  const remaining = session.maxGold - session.spent;
  if (cost > gold || cost > remaining) {
    throw new Error(
      `This transaction needs ${cost.toLocaleString()} gold. You have ${gold.toLocaleString()} gold and ${remaining.toLocaleString()} left in the spending limit. No items were purchased for this transaction.`,
    );
  }
  if (cost > 0)
    yield* script.log(
      `Planned purchases: up to ${cost.toLocaleString()} gold. Spent so far: ${session.spent.toLocaleString()}.`,
    );
  for (const step of steps) {
    if ("scroll" in step) {
      yield* ensureScroll({ ...step.scroll, target: step.target });
      continue;
    }
    if ("target" in step) {
      if (!step.source.monster)
        throw new Error(`No monster is registered for ${step.source.item}.`);
      yield* script.log(
        `Farming ${step.source.name || step.source.item} to ${step.target} in ${step.source.map}.`,
      );
      if (
        !(yield* api.player.joinMap(
          step.source.map,
          step.source.cell
            ? { cell: step.source.cell, pad: step.source.pad }
            : undefined,
        ))
      ) {
        throw new Error(`Could not reach ${step.source.map}.`);
      }
      if (
        !(yield* api.combat.killForItem(step.source.monster, {
          item: step.source.item,
          quantity: step.target,
        }))
      ) {
        throw new Error(
          `Could not farm ${step.source.item}. Check your combat profile and map access.`,
        );
      }
      if ((yield* quantity(step.source.item)) < step.target)
        throw new Error(
          `Farming did not deliver ${step.target} ${step.source.name ?? step.source.item}.`,
        );
      continue;
    }
    yield* open(step.source);
    const selector = { shopItemId: step.info.shopItemId };
    const current = snapshotOffer(yield* api.shop.get(selector));
    if (!current || JSON.stringify(current) !== JSON.stringify(step.info)) {
      throw new Error(
        `The purchase recipe for ${step.info.name} changed. Run the script again to recalculate.`,
      );
    }
    const price = step.info.cost * step.units;
    const beforeGold = yield* api.player.getGold();
    if (
      price > beforeGold ||
      price > session.maxGold - session.spent ||
      !(yield* api.shop.canBuy(selector, { quantity: step.units }))
    ) {
      throw new Error(
        `Cannot buy ${step.units} ${step.info.name}. Check gold, inventory space, membership, and reputation requirements.`,
      );
    }
    yield* script.log(
      `Buying ${step.units} ${step.info.name} for up to ${price.toLocaleString()} gold.`,
    );
    const before = yield* quantity(step.info.itemId);
    if (!(yield* api.shop.buy(selector, { quantity: step.units }))) {
      throw new Error(
        `Purchase of ${step.info.name} failed. Stopping without retrying the transaction.`,
      );
    }
    session.spent += Math.max(
      price,
      beforeGold - (yield* api.player.getGold()),
    );
    yield* unbank(step.info.itemId, step.info.name);
    if ((yield* quantity(step.info.itemId)) < before + step.units) {
      throw new Error(
        `The purchase of ${step.info.name} did not reach inventory.`,
      );
    }
  }
}

module.exports = { acquire, materialSource };
