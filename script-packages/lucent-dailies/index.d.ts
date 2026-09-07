declare module "@lucent/dailies" {
  export interface WheelOfDoomOptions {
    readonly bankRewards?: boolean;
  }

  export type WheelOfDoomSpinOutcome =
    | { readonly status: "unavailable" }
    | { readonly status: "failed" }
    | {
        readonly status: "completed";
        readonly banking: "not-requested" | "completed" | "failed";
      };

  export interface WheelOfDoomResult {
    readonly daily: WheelOfDoomSpinOutcome;
    readonly weekly: WheelOfDoomSpinOutcome;
  }

  export function spinWheelOfDoom(
    options?: WheelOfDoomOptions,
  ): ScriptGenerator<WheelOfDoomResult>;
}
