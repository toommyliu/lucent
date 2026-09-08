// @ts-check

const script = require("lucent/script");
const consumables = require("@lucent/consumables");

function* run() {
  const { potions, scrolls, quantity, potionMethod, mode, maxGold, maxCrafts } =
    yield* script.inputs.getAll();
  if (
    !Array.isArray(potions) ||
    !Array.isArray(scrolls) ||
    typeof quantity !== "number" ||
    (potionMethod !== "Buy" && potionMethod !== "Craft") ||
    (mode !== "Buy" && mode !== "Farm") ||
    typeof maxGold !== "number" ||
    typeof maxCrafts !== "number"
  )
    throw new Error(
      "Choose consumables, a target quantity, and spending limits in the script inputs.",
    );
  /** @type {import("@lucent/consumables").ConsumableRequest[]} */
  const requests = [];
  for (const item of [...potions, ...scrolls]) {
    const name = [...consumables.potionNames, ...consumables.scrollNames].find(
      (name) => name === item,
    );
    if (!name) throw new Error(`Unknown consumable: ${item}.`);
    requests.push({ item: name, quantity });
  }
  yield* consumables.ensure(requests, {
    potionMethod: potionMethod === "Buy" ? "buy" : "craft",
    mode: mode === "Buy" ? "buy" : "farm",
    maxGold,
    maxCrafts,
  });
}

module.exports = run;

module.exports.inputs = {
  id: "lucent-consumables",
  fields: [
    {
      key: "potions",
      type: "multi-select",
      label: "Potions",
      options: [
        "Judgment Tonic",
        "Fortitude Tonic",
        "Fate Tonic",
        "Sage Tonic",
        "Potent Battle Elixir",
        "Potent Malevolence Elixir",
        "Potent Honor Potion",
        "Unstable Divine Elixir",
        "Potent Revitalize Elixir",
        "Potent Destruction Elixir",
        "Body Tonic",
        "Soul Potion",
        "Unstable Battle Elixir",
        "Unstable Body Tonic",
        "Unstable Fate Tonic",
        "Unstable Keen Elixir",
        "Unstable Mastery Tonic",
        "Unstable Might Tonic",
        "Unstable Wise Tonic",
        "Might Tonic",
        "Malice Potion",
        "Potent Life Potion",
        "Endurance Draught",
        "Felicitous Philtre",
      ],
      default: [],
    },
    {
      key: "scrolls",
      type: "multi-select",
      label: "Scrolls",
      options: [
        "Scroll of Fireball",
        "Scroll of Shadowburn",
        "Scroll of Plasma Bolt",
        "Scroll of Dark Energy",
        "Scroll of Ssikari's Breath",
        "Scroll of Shadow Bolt",
        "Scroll of Diamond Cage",
        "Scroll of Exorcise",
        "Scroll of Acid Rain",
        "Scroll of Heartbeat",
        "Scroll of Corrosion",
        "Scroll of Crushing Wave",
        "Scroll of Wind Strike",
        "Scroll of Arc Lightning",
        "Scroll of Spirit Rend",
        "Scroll of Dark Arc",
        "Scroll of Chains",
        "Scroll of Eclipse",
        "Scroll of Purge",
        "Scroll of Scorched Steel",
        "Scroll of Firebolt",
        "Scroll of Holy Bolt",
        "Scroll of Blessed Shard",
        "Scroll of Frostbite",
        "Scroll of Geyser",
        "Scroll of Fire Flare",
        "Scroll of Frost Flare",
        "Scroll of Plague Flare",
        "Scroll of Charged Flare",
        "Scroll of Doom Flare",
        "Scroll of Holy Flare",
        "Scroll of Blinding Light",
        "Scroll of Guardian Blast",
        "Scroll of Shadowblade",
        "Scroll of Furious Gale",
        "Scroll of Enrage",
        "Scroll of Decay",
        "Scroll of Death Pact",
        "Scroll of Cantor's Lament",
        "Scroll of Pulse Compression",
        "Scroll of Dissonance",
        "Scroll of Soul Crush",
        "Scroll of Void Strike",
        "Scroll of Psychic Wave",
        "Scroll of Chaos Fog",
        "Scroll of Torment",
        "Scroll of Shiftburn",
        "Scroll of Freezing Flame",
        "Scroll of Fire Storm",
        "Scroll of Mystify",
        "Scroll of Wither",
        "Scroll of Underworld",
        "Scroll of Ethereal Slumber",
        "Scroll of Ethereal Curse",
        "Scroll of Dark Grip",
        "Scroll of Weaken",
        "Scroll of Bane",
        "Scroll of Petrify",
        "Scroll of Cripple",
        "Scroll of Life Steal",
      ],
      default: ["Scroll of Enrage"],
    },
    {
      key: "quantity",
      type: "number",
      label: "Quantity per item",
      description: "Target total, including owned items. Stack limits apply.",
      default: 100,
      required: true,
    },
    {
      key: "potionMethod",
      type: "select",
      label: "Potion method",
      options: ["Buy", "Craft"],
      default: "Buy",
      required: true,
    },
    {
      key: "mode",
      type: "select",
      label: "Ingredient source",
      options: ["Farm", "Buy"],
      default: "Farm",
      required: true,
    },
    {
      key: "maxCrafts",
      type: "number",
      label: "Alchemy attempt limit",
      default: 100,
      required: true,
    },
    {
      key: "maxGold",
      type: "number",
      label: "Gold spending limit",
      description: "Total for this run. Set to 0 to spend no gold.",
      default: 1000000,
      required: true,
    },
  ],
};
