import type {
  AccountLaunchTilingPlacement,
  AccountLaunchWindowTarget,
} from "@lucent/core/accounts";

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

export function resolveAccountLaunchWindowTarget(
  newWindow: boolean,
  firstGameWindowId: number | undefined,
): AccountLaunchWindowTarget | undefined {
  if (!newWindow) return undefined;
  return firstGameWindowId === undefined
    ? { kind: "new" }
    : { gameWindowId: firstGameWindowId, kind: "same-as-game" };
}
