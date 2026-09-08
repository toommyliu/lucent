declare module "@lucent/consumables" {
  /** Potion names accepted by ensure and listed in potionNames. */
  export type PotionName =
    | "Judgment Tonic"
    | "Fortitude Tonic"
    | "Fate Tonic"
    | "Sage Tonic"
    | "Potent Battle Elixir"
    | "Potent Malevolence Elixir"
    | "Potent Honor Potion"
    | "Unstable Divine Elixir"
    | "Potent Revitalize Elixir"
    | "Potent Destruction Elixir"
    | "Body Tonic"
    | "Soul Potion"
    | "Unstable Battle Elixir"
    | "Unstable Body Tonic"
    | "Unstable Fate Tonic"
    | "Unstable Keen Elixir"
    | "Unstable Mastery Tonic"
    | "Unstable Might Tonic"
    | "Unstable Wise Tonic"
    | "Might Tonic"
    | "Malice Potion"
    | "Potent Life Potion"
    | "Endurance Draught"
    | "Felicitous Philtre";

  /** Scroll names accepted by ensure and listed in scrollNames. */
  export type ScrollName =
    | "Scroll of Fireball"
    | "Scroll of Shadowburn"
    | "Scroll of Plasma Bolt"
    | "Scroll of Dark Energy"
    | "Scroll of Ssikari's Breath"
    | "Scroll of Shadow Bolt"
    | "Scroll of Diamond Cage"
    | "Scroll of Exorcise"
    | "Scroll of Acid Rain"
    | "Scroll of Heartbeat"
    | "Scroll of Corrosion"
    | "Scroll of Crushing Wave"
    | "Scroll of Wind Strike"
    | "Scroll of Arc Lightning"
    | "Scroll of Spirit Rend"
    | "Scroll of Dark Arc"
    | "Scroll of Chains"
    | "Scroll of Eclipse"
    | "Scroll of Purge"
    | "Scroll of Scorched Steel"
    | "Scroll of Firebolt"
    | "Scroll of Holy Bolt"
    | "Scroll of Blessed Shard"
    | "Scroll of Frostbite"
    | "Scroll of Geyser"
    | "Scroll of Fire Flare"
    | "Scroll of Frost Flare"
    | "Scroll of Plague Flare"
    | "Scroll of Charged Flare"
    | "Scroll of Doom Flare"
    | "Scroll of Holy Flare"
    | "Scroll of Blinding Light"
    | "Scroll of Guardian Blast"
    | "Scroll of Shadowblade"
    | "Scroll of Furious Gale"
    | "Scroll of Enrage"
    | "Scroll of Decay"
    | "Scroll of Death Pact"
    | "Scroll of Cantor's Lament"
    | "Scroll of Pulse Compression"
    | "Scroll of Dissonance"
    | "Scroll of Soul Crush"
    | "Scroll of Void Strike"
    | "Scroll of Psychic Wave"
    | "Scroll of Chaos Fog"
    | "Scroll of Torment"
    | "Scroll of Shiftburn"
    | "Scroll of Freezing Flame"
    | "Scroll of Fire Storm"
    | "Scroll of Mystify"
    | "Scroll of Wither"
    | "Scroll of Underworld"
    | "Scroll of Ethereal Slumber"
    | "Scroll of Ethereal Curse"
    | "Scroll of Dark Grip"
    | "Scroll of Weaken"
    | "Scroll of Bane"
    | "Scroll of Petrify"
    | "Scroll of Cripple"
    | "Scroll of Life Steal";

  /** A consumable and the total quantity to have in inventory. */
  export interface ConsumableRequest {
    /** A supported potion or scroll. */
    readonly item: PotionName | ScrollName;
    /** Inventory target, including banked stock; capped at the item stack limit. */
    readonly quantity: number;
  }

  /** Acquisition methods and limits shared across all requested consumables. */
  export interface ConsumableOptions {
    /** Buy finished potions or craft with alchemy. Defaults to buy. Scroll quests are unchanged. */
    readonly potionMethod?: "buy" | "craft";
    /** How to obtain ingredients. Defaults to farm. */
    readonly mode?: "farm" | "buy";
    /** Gold spending limit shared across the entire call. Defaults to 1,000,000. */
    readonly maxGold?: number;
    /** Total alchemy attempt limit, including other potion outcomes. Defaults to 100. */
    readonly maxCrafts?: number;
  }

  /**
   * Gets the requested quantities of potions and scrolls, using banked stock first.
   *
   * @param requests Consumables and inventory targets, including existing banked stock.
   * @param options Acquisition methods and limits shared across the entire call.
   * @example
   * ```js
   * const pkg = require("@lucent/consumables");
   *
   * module.exports = function* run() {
   *   yield* pkg.ensure([{ item: "Potent Honor Potion", quantity: 50 }]);
   * };
   * ```
   */
  export function ensure(
    requests: readonly ConsumableRequest[],
    options?: ConsumableOptions,
  ): ScriptGenerator<void>;
  /** All supported potion names. */
  export const potionNames: readonly PotionName[];
  /** All supported scroll names. */
  export const scrollNames: readonly ScrollName[];
}
