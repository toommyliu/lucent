import type {
  ScriptPackageSummary,
  ValidScriptPackage,
} from "@lucent/core/scriptPackages";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface ActiveScriptPackageRateLimit {
  readonly retryAt: string;
  readonly retryAtTimestamp: number;
}

export type ScriptPackageRateLimitTiming =
  | {
      readonly status: "active" | "elapsed";
      readonly retryAtTimestamp: number;
    }
  | { readonly status: "invalid" };

/** Classifies a saved retry deadline without changing its persisted state. */
export const scriptPackageRateLimitTiming = (
  retryAt: string,
  now: number,
): ScriptPackageRateLimitTiming => {
  const retryAtTimestamp = Date.parse(retryAt);
  if (!Number.isFinite(retryAtTimestamp)) return { status: "invalid" };
  return {
    status: retryAtTimestamp > now ? "active" : "elapsed",
    retryAtTimestamp,
  };
};

/** Maps the saved credential selection to the GitHub request scope it affects. */
export const scriptPackageCredentialRateLimitScope = (
  credentialId: string | undefined,
): string =>
  credentialId === undefined ? "public" : `credential:${credentialId}`;

export const scriptPackageRateLimitScope = (
  entry: ValidScriptPackage,
): string | undefined =>
  entry.source === undefined
    ? undefined
    : scriptPackageCredentialRateLimitScope(entry.source.credentialId);

/** Collects active GitHub limits by the credential or public access they affect. */
export const activeScriptPackageRateLimits = (
  packages: readonly ScriptPackageSummary[],
  now: number,
): ReadonlyMap<string, ActiveScriptPackageRateLimit> => {
  const limits = new Map<string, ActiveScriptPackageRateLimit>();
  for (const entry of packages) {
    if (
      entry.status !== "valid" ||
      entry.source === undefined ||
      entry.update.status !== "rate-limited"
    ) {
      continue;
    }

    const timing = scriptPackageRateLimitTiming(entry.update.retryAt, now);
    if (timing.status !== "active") continue;
    const { retryAtTimestamp } = timing;

    const scope = scriptPackageCredentialRateLimitScope(
      entry.source.credentialId,
    );
    const previous = limits.get(scope);
    if (
      previous !== undefined &&
      previous.retryAtTimestamp >= retryAtTimestamp
    ) {
      continue;
    }
    limits.set(scope, {
      retryAt: entry.update.retryAt,
      retryAtTimestamp,
    });
  }
  return limits;
};

/** Finds the active GitHub cooldown that applies to a package's saved source. */
export const scriptPackageRateLimit = (
  entry: ValidScriptPackage,
  limits: ReadonlyMap<string, ActiveScriptPackageRateLimit>,
): ActiveScriptPackageRateLimit | undefined => {
  const scope = scriptPackageRateLimitScope(entry);
  return scope === undefined ? undefined : limits.get(scope);
};

/** Returns managed packages whose GitHub sources can be checked right now. */
export const scriptPackagesEligibleForUpdateCheck = (
  packages: readonly ScriptPackageSummary[],
  limits: ReadonlyMap<string, ActiveScriptPackageRateLimit>,
): readonly ValidScriptPackage[] =>
  packages.filter(
    (entry): entry is ValidScriptPackage =>
      entry.status === "valid" &&
      entry.source !== undefined &&
      scriptPackageRateLimit(entry, limits) === undefined,
  );

/** Formats a compact action label while preserving an exact retry deadline. */
export const formatScriptPackageRetryLabel = (
  retryAtTimestamp: number,
  now: number,
): string => {
  const remaining = retryAtTimestamp - now;
  if (remaining <= 0) return "Check again";
  if (remaining < MINUTE_MS) return "Retry in <1m";
  if (remaining < HOUR_MS) {
    return `Retry in ${Math.ceil(remaining / MINUTE_MS)}m`;
  }
  if (remaining < DAY_MS) {
    return `Retry in ${Math.ceil(remaining / HOUR_MS)}h`;
  }
  return `Retry in ${Math.ceil(remaining / DAY_MS)}d`;
};
