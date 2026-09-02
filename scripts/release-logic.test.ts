import { describe, expect, it } from "vitest";

import {
  extractReleaseNotesFromChangelog,
  findFirstStableRelease,
  formatReleaseTag,
  gitCliffChangelogArgs,
  makeInitialChangelog,
  RELEASE_NOTES_PLACEHOLDER_CONTENT,
  releaseNotesAreReady,
  resolveTargetVersion,
  validateReleaseInputs,
} from "./release-logic";

describe("release logic", () => {
  it("requires an explicit version for the first release", () => {
    expect(resolveTargetVersion("patch", null)).toEqual({
      ok: false,
      message:
        "The first release requires an explicit stable version like 0.0.1.",
    });
    expect(resolveTargetVersion("0.0.1", null)).toEqual({
      ok: true,
      version: "0.0.1",
    });
  });

  it("uses v-prefixed stable tags for later releases", () => {
    const latestRelease = findFirstStableRelease([
      "nightly",
      "0.0.2",
      "v0.0.1-beta.1",
      "v0.0.1",
    ]);

    expect(latestRelease).toEqual({
      tag: "v0.0.1",
      version: { major: 0, minor: 0, patch: 1 },
    });
    expect(resolveTargetVersion("patch", latestRelease)).toEqual({
      ok: true,
      version: "0.0.2",
    });
    expect(formatReleaseTag("0.0.2")).toBe("v0.0.2");
  });

  it("builds the initial changelog from curated notes", () => {
    expect(
      makeInitialChangelog({
        date: "2026-08-31",
        notes: "Initial release notes.\n",
        tag: "v0.0.1",
        version: "0.0.1",
      }),
    ).toBe(
      "# Changelog\n\n" +
        "All notable changes to this project will be documented in this file.\n\n" +
        "# [0.0.1](https://github.com/toommyliu/lucent/tree/v0.0.1) - (2026-08-31)\n" +
        "Initial release notes.\n",
    );
  });

  it("requires the first release notes placeholder to be replaced", () => {
    expect(releaseNotesAreReady(RELEASE_NOTES_PLACEHOLDER_CONTENT)).toBe(false);
    expect(releaseNotesAreReady("## Highlights\n\nReady.")).toBe(true);
  });

  it("generates only unreleased changes for later releases", () => {
    expect(gitCliffChangelogArgs("v0.0.2")).toEqual([
      "--config",
      "cliff.toml",
      "--unreleased",
      "--tag",
      "v0.0.2",
      "--prepend",
      "CHANGELOG.md",
    ]);
  });

  it("rejects mismatched tags", () => {
    expect(
      validateReleaseInputs({
        packageVersion: "0.0.1",
        tag: "0.0.1",
      }),
    ).toBe(
      "Release tag 0.0.1 does not match app version 0.0.1. Expected v0.0.1.",
    );
  });

  it("extracts one release body from the changelog", () => {
    const changelog =
      "# Changelog\n\n" +
      "# [0.0.2](https://example.com/v0.0.2) - (2026-08-31)\n\n" +
      "## Features\n\n- A later feature\n\n" +
      "# [0.0.1](https://example.com/v0.0.1) - (2026-08-30)\n\n" +
      "## Highlights\n\nInitial release.\n";

    expect(extractReleaseNotesFromChangelog(changelog, "v0.0.2")).toBe(
      "## Features\n\n- A later feature\n",
    );
    expect(extractReleaseNotesFromChangelog(changelog, "v0.0.3")).toBeNull();
  });
});
