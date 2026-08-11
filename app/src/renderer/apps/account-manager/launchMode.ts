import type { AccountLaunchTilingPlacement } from "@lucent/core/accounts";

export type AccountLaunchMode = "standard" | "auto-grid";

export function resolveAccountLaunchTiling(
  mode: AccountLaunchMode,
  index: number,
  count: number,
): AccountLaunchTilingPlacement | undefined {
  return mode === "auto-grid" && count > 1
    ? { algorithm: "auto-grid", index, count }
    : undefined;
}
