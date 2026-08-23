import { describe, expect, it } from "vitest";

import type {
  ScriptPackageUpdateState,
  ValidScriptPackage,
} from "@lucent/core/scriptPackages";
import {
  activeScriptPackageRateLimits,
  formatScriptPackageRetryLabel,
  scriptPackageRateLimit,
  scriptPackageRateLimitTiming,
  scriptPackagesEligibleForUpdateCheck,
} from "./scriptPackageRateLimit";

const now = Date.parse("2026-08-02T12:00:00.000Z");

const packageEntry = (
  name: string,
  update: ScriptPackageUpdateState,
  credentialId?: string,
): ValidScriptPackage => ({
  status: "valid",
  compatibility: {
    status: "compatible",
    currentVersion: "1.0.0",
    requiredVersion: ">=1.0.0",
  },
  dependencyStatus: { status: "ready" },
  integrity: "verified",
  name,
  path: `/packages/${name}`,
  source: {
    repositoryUrl: `https://github.com/example/${name}`,
    resolvedCommit: "9141d4488219b3351f6ce3eee6a76783cdf1e15d",
    ...(credentialId === undefined ? {} : { credentialId }),
  },
  update,
});

describe("script package rate limits", () => {
  it("shares a public limit across public packages", () => {
    const retryAt = new Date(now + 5 * 60_000).toISOString();
    const limited = packageEntry("limited", {
      status: "rate-limited",
      message: "GitHub's request limit has been reached.",
      retryAt,
    });
    const anotherPublicPackage = packageEntry("public", {
      status: "unchecked",
    });
    const authenticatedPackage = packageEntry(
      "authenticated",
      { status: "unchecked" },
      "github:private",
    );
    const limits = activeScriptPackageRateLimits(
      [limited, anotherPublicPackage, authenticatedPackage],
      now,
    );

    expect(scriptPackageRateLimit(anotherPublicPackage, limits)?.retryAt).toBe(
      retryAt,
    );
    expect(
      scriptPackageRateLimit(authenticatedPackage, limits),
    ).toBeUndefined();
  });

  it("shares a limit only between packages using the same credential", () => {
    const retryAt = new Date(now + 5 * 60_000).toISOString();
    const limited = packageEntry(
      "limited",
      {
        status: "rate-limited",
        message: "GitHub's request limit has been reached.",
        retryAt,
      },
      "github:shared",
    );
    const shared = packageEntry(
      "shared",
      { status: "unchecked" },
      "github:shared",
    );
    const separate = packageEntry(
      "separate",
      { status: "unchecked" },
      "github:separate",
    );
    const limits = activeScriptPackageRateLimits(
      [limited, shared, separate],
      now,
    );

    expect(scriptPackageRateLimit(shared, limits)?.retryAt).toBe(retryAt);
    expect(scriptPackageRateLimit(separate, limits)).toBeUndefined();
  });

  it("uses the latest active deadline within one request scope", () => {
    const earlierRetryAt = new Date(now + 2 * 60_000).toISOString();
    const laterRetryAt = new Date(now + 5 * 60_000).toISOString();
    const limits = activeScriptPackageRateLimits(
      [
        packageEntry("earlier", {
          status: "rate-limited",
          message: "GitHub's request limit has been reached.",
          retryAt: earlierRetryAt,
        }),
        packageEntry("later", {
          status: "rate-limited",
          message: "GitHub's request limit has been reached.",
          retryAt: laterRetryAt,
        }),
      ],
      now,
    );

    expect(limits.get("public")?.retryAt).toBe(laterRetryAt);
  });

  it("selects sourced packages outside active request cooldowns", () => {
    const retryAt = new Date(now + 5 * 60_000).toISOString();
    const limited = packageEntry("limited", {
      status: "rate-limited",
      message: "GitHub's request limit has been reached.",
      retryAt,
    });
    const sameScope = packageEntry("same-scope", { status: "unchecked" });
    const separateScope = packageEntry(
      "separate-scope",
      { status: "unchecked" },
      "github:separate",
    );
    const unmanaged: ValidScriptPackage = {
      status: "valid",
      compatibility: {
        status: "compatible",
        currentVersion: "1.0.0",
        requiredVersion: ">=1.0.0",
      },
      dependencyStatus: { status: "ready" },
      integrity: "unmanaged",
      name: "unmanaged",
      path: "/packages/unmanaged",
      update: { status: "unchecked" },
    };
    const packages = [limited, sameScope, separateScope, unmanaged];
    const limits = activeScriptPackageRateLimits(packages, now);

    expect(
      scriptPackagesEligibleForUpdateCheck(packages, limits).map(
        (entry) => entry.name,
      ),
    ).toEqual(["separate-scope"]);
  });

  it("ignores elapsed and invalid retry timestamps after reload", () => {
    const elapsed = packageEntry("elapsed", {
      status: "rate-limited",
      message: "GitHub's request limit has been reached.",
      retryAt: new Date(now).toISOString(),
    });
    const invalid = packageEntry("invalid", {
      status: "rate-limited",
      message: "GitHub's request limit has been reached.",
      retryAt: "not-a-date",
    });

    expect(activeScriptPackageRateLimits([elapsed, invalid], now).size).toBe(0);
  });

  it("formats a compact retry action that becomes actionable", () => {
    expect(formatScriptPackageRetryLabel(now + 5 * 60_000, now)).toBe(
      "Retry in 5m",
    );
    expect(formatScriptPackageRetryLabel(now + 30_000, now)).toBe(
      "Retry in <1m",
    );
    expect(formatScriptPackageRetryLabel(now, now)).toBe("Check again");
  });

  it("distinguishes active, elapsed, and invalid retry deadlines", () => {
    expect(
      scriptPackageRateLimitTiming(new Date(now + 60_000).toISOString(), now),
    ).toEqual({ status: "active", retryAtTimestamp: now + 60_000 });
    expect(
      scriptPackageRateLimitTiming(new Date(now).toISOString(), now),
    ).toEqual({ status: "elapsed", retryAtTimestamp: now });
    expect(scriptPackageRateLimitTiming("not-a-date", now)).toEqual({
      status: "invalid",
    });
  });
});
