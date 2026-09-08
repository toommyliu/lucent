// @ts-check

const api = require("lucent/api");
const script = require("lucent/script");

/** @param {string | number} item */
function* quantity(item) {
  return (yield* api.inventory.get(item))?.quantity ?? 0;
}

/** @param {string | number} item
 * @param {string | number} [name] */
function* unbank(item, name = item) {
  if (!(yield* api.bank.contains(item))) return;
  yield* script.log(
    `Withdrawing ${typeof name === "string" ? name : `item ${name}`} from the bank.`,
  );
  if (!(yield* api.bank.withdraw(item))) {
    throw new Error(`Could not withdraw ${item}. Make room in your inventory.`);
  }
}

/** @param {string | number} item */
function* acceptDrop(item) {
  if ((yield* api.drops.contains(item)) && !(yield* api.drops.accept(item)))
    throw new Error(`Could not collect ${item}. Make room in your inventory.`);
}

/** Waits for delayed quest or crafting rewards, including banked grants.
 * @param {string | number} item
 * @param {number} target */
function* collect(item, target) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    yield* unbank(item);
    yield* acceptDrop(item);
    if ((yield* quantity(item)) >= target) return true;
    yield* script.sleep("250 millis");
  }
  return false;
}

module.exports = { quantity, unbank, acceptDrop, collect };
