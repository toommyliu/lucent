// @ts-check

const api = require("lucent/api");
const script = require("lucent/script");
const s = require("lucent/schema");
const { potions, scrolls } = require("./lib/catalog");
const { preparePotion, ensurePotion } = require("./lib/potions");
const { prepareScroll } = require("./lib/scrolls");
const { acquire } = require("./lib/supplies");

const optionsSchema = s.object({
  potionMethod: s.enum(["buy", "craft"]).default("buy"),
  mode: s.enum(["farm", "buy"]).default("farm"),
  maxGold: s
    .number()
    .int()
    .min(0, {
      message: "The gold limit must be a whole number of 0 or more.",
    })
    .default(1_000_000),
  maxCrafts: s
    .number()
    .int()
    .min(1, {
      message: "The alchemy attempt limit must be a positive whole number.",
    })
    .default(100),
});
const requestsSchema = s
  .array(
    s.object({
      item: s
        .string()
        .refine(
          (name) =>
            Object.prototype.hasOwnProperty.call(potions, name) ||
            Object.prototype.hasOwnProperty.call(scrolls, name),
          { message: "Choose a supported consumable." },
        ),
      quantity: s
        .number()
        .int()
        .min(1, { message: "Choose a positive whole quantity." }),
    }),
  )
  .min(1, { message: "Select at least one consumable." });

/** Gets inventory totals, sharing one spending and crafting limit across the selection.
 * @param {readonly import("@lucent/consumables").ConsumableRequest[]} requests
 * @param {import("@lucent/consumables").ConsumableOptions} [options]
 * @returns {Generator<unknown, void, unknown>} */
function* ensure(requests, options = {}) {
  const { potionMethod, mode, maxGold, maxCrafts } =
    optionsSchema.parse(options);
  /** @type {Map<string, number>} */
  const targets = new Map();
  for (const request of requestsSchema.parse(requests)) {
    targets.set(
      request.item,
      Math.max(targets.get(request.item) ?? 0, request.quantity),
    );
  }
  if (!(yield* api.bank.load()))
    throw new Error(
      "Could not load the bank. Stopping before buying or farming duplicate items.",
    );
  /** @type {import("./lib/types").Session} */
  const session = {
    wanted: new Set([...targets.keys()].map((name) => name.toLowerCase())),
    potionMethod,
    mode,
    maxGold,
    maxCrafts,
    spent: 0,
    crafts: 0,
  };
  yield* script.log(
    `Getting ${targets.size} consumable types. Potion method: ${potionMethod}. Ingredient source: ${mode}. Gold limit: ${maxGold.toLocaleString()}.`,
  );
  /** @type {import("./lib/types").Goal[]} */
  const goals = [];
  const potionJobs = [];
  for (const [name, target] of targets) {
    if (Object.prototype.hasOwnProperty.call(potions, name)) {
      const recipe = potions[name];
      const prepared = yield* preparePotion(name, recipe, target, session);
      if (!prepared) continue;
      if (prepared.goal) goals.push(prepared.goal);
      else potionJobs.push({ name, recipe, target: prepared.target });
    } else {
      const prepared = yield* prepareScroll(scrolls[name], target, session);
      if (!prepared) continue;
      goals.push(prepared);
    }
  }
  // Known purchases share one plan; random alchemy outcomes are budgeted per attempt.
  yield* acquire(goals, session);
  for (const { name, recipe, target } of potionJobs)
    yield* ensurePotion(name, recipe, target, session);
  yield* script.log(
    `Consumables ready. Gold spent: ${session.spent.toLocaleString()}.`,
  );
}

module.exports = {
  ensure,
  potionNames: Object.freeze(
    Object.keys(potions).filter((name) => name !== "Scroll of Life Steal"),
  ),
  scrollNames: Object.freeze([...Object.keys(scrolls), "Scroll of Life Steal"]),
};
