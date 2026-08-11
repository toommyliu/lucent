export interface ScriptPackageUpdateCheckResult {
  readonly failedCount: number;
  readonly failedPackageNames: readonly string[];
  readonly succeededCount: number;
}

type ScriptPackageUpdateCheckOutcome = "checked" | "skipped";

// Every package is still checked and counted; this only keeps the alert summary short.
const MAX_FAILURE_NAMES_IN_ALERT = 3;

/** Runs package update checks in order without stopping after a failure. */
export const checkScriptPackageUpdatesSerially = async (
  packageNames: readonly string[],
  checkPackage: (
    packageName: string,
  ) =>
    | PromiseLike<ScriptPackageUpdateCheckOutcome>
    | ScriptPackageUpdateCheckOutcome,
): Promise<ScriptPackageUpdateCheckResult> => {
  const failedPackageNames: string[] = [];
  let failedCount = 0;
  let succeededCount = 0;

  for (const packageName of packageNames) {
    try {
      if ((await checkPackage(packageName)) === "checked") {
        succeededCount += 1;
      }
    } catch {
      failedCount += 1;
      if (failedPackageNames.length < MAX_FAILURE_NAMES_IN_ALERT) {
        failedPackageNames.push(packageName);
      }
    }
  }

  return { failedCount, failedPackageNames, succeededCount };
};

/** Formats the alert shown after a batch finishes with failed checks. */
export const formatScriptPackageUpdateCheckFailures = (
  result: ScriptPackageUpdateCheckResult,
): string => {
  if (result.failedCount === 0) return "";

  const shownNames = result.failedPackageNames
    .map((packageName) => `“${packageName}”`)
    .join(", ");
  const hiddenCount = result.failedCount - result.failedPackageNames.length;
  const nameSummary =
    hiddenCount > 0
      ? `${shownNames}, and ${hiddenCount.toString()} more`
      : shownNames;
  const failureSummary =
    result.failedCount === 1
      ? `Failed to check ${nameSummary} for updates.`
      : `Failed to check ${result.failedCount.toString()} packages for updates: ${nameSummary}.`;

  if (result.succeededCount === 0) return failureSummary;
  const packageLabel = result.succeededCount === 1 ? "package" : "packages";
  return `${failureSummary} ${result.succeededCount.toString()} other ${packageLabel} checked successfully.`;
};
