import { describe, expect, it } from "vitest";

import {
  checkScriptPackageUpdatesSerially,
  formatScriptPackageUpdateCheckFailures,
} from "./scriptPackageUpdateCheck";

describe("script package update checks", () => {
  it("continues serially after a package check fails", async () => {
    const calls: string[] = [];
    let activeChecks = 0;
    let maximumActiveChecks = 0;

    const result = await checkScriptPackageUpdatesSerially(
      ["first", "broken", "last"],
      async (packageName) => {
        calls.push(packageName);
        activeChecks += 1;
        maximumActiveChecks = Math.max(maximumActiveChecks, activeChecks);
        try {
          await Promise.resolve();
          if (packageName === "broken") throw new Error("write failed");
          return "checked" as const;
        } finally {
          activeChecks -= 1;
        }
      },
    );

    expect(calls).toEqual(["first", "broken", "last"]);
    expect(maximumActiveChecks).toBe(1);
    expect(result).toEqual({
      failedCount: 1,
      failedPackageNames: ["broken"],
      succeededCount: 2,
    });
  });

  it("caps alert names while counting synchronous and async failures", async () => {
    const result = await checkScriptPackageUpdatesSerially(
      ["sync", "async", "third", "hidden", "working"],
      (packageName) => {
        if (packageName === "working") return "checked";
        if (packageName === "async") {
          return Promise.reject(new Error("async failure"));
        }
        throw new Error("sync failure");
      },
    );

    expect(result).toEqual({
      failedCount: 4,
      failedPackageNames: ["sync", "async", "third"],
      succeededCount: 1,
    });
    expect(formatScriptPackageUpdateCheckFailures(result)).toBe(
      "Failed to check 4 packages for updates: “sync”, “async”, “third”, and 1 more. 1 other package checked successfully.",
    );
  });
});
