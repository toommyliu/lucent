declare module "@lucent/dailies" {
  /** Options for the daily and weekly Wheel of Doom attempts. */
  export interface WheelOfDoomOptions {
    /** Bank rewards after each spin. Defaults to false. */
    readonly bankRewards?: boolean;
  }

  /** Whether a spin was available, completed, and its rewards banked. */
  export type WheelOfDoomSpinOutcome =
    | { readonly status: "unavailable" }
    | { readonly status: "failed" }
    | {
        readonly status: "completed";
        readonly banking: "not-requested" | "completed" | "failed";
      };

  /** Separate results for the member-daily spin and the three-Gear weekly spin. */
  export interface WheelOfDoomResult {
    readonly daily: WheelOfDoomSpinOutcome;
    readonly weekly: WheelOfDoomSpinOutcome;
  }

  /**
   * Attempts the member-daily spin, then the weekly spin with three Gear of Doom.
   *
   * @param options Whether to bank rewards after each spin.
   * @example
   * ```js
   * const Dailies = require("@lucent/dailies");
   *
   * module.exports = function* run() {
   *   return yield* Dailies.spinWheelOfDoom({ bankRewards: true });
   * };
   * ```
   */
  export function spinWheelOfDoom(
    options?: WheelOfDoomOptions,
  ): ScriptGenerator<WheelOfDoomResult>;

  /** Whether the Elders' Blood daily was completed, skipped, or failed. */
  export interface EldersBloodResult {
    readonly status: "completed" | "maxed" | "unavailable" | "failed";
  }

  /**
   * Completes the Elders' Blood daily in arcangrove. Skips the quest when
   * Elders' Blood is already at its stack limit.
   *
   * @example
   * ```js
   * const Dailies = require("@lucent/dailies");
   *
   * module.exports = function* run() {
   *   return yield* Dailies.farmEldersBlood();
   * };
   * ```
   */
  export function farmEldersBlood(): ScriptGenerator<EldersBloodResult>;
}
