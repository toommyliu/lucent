import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_OBSERVABILITY_PORT, parseCliOptions } from "./cli";

describe("main CLI", () => {
  it("parses supported options and ignores malformed values", () => {
    const cwd = join(tmpdir(), "lucent-cli");

    const parsed = parseCliOptions(
      [
        "--flash-plugin-path=PepperFlashPlayer.plugin",
        "--flash-version",
        "32.0.0.371",
        "--launch-mode",
        "account-manager",
        "--obs",
      ],
      { cwd },
    );
    expect(parsed).toEqual({
      flashPluginPath: join(cwd, "PepperFlashPlayer.plugin"),
      flashVersion: "32.0.0.371",
      launchMode: "account-manager",
      obs: { port: DEFAULT_OBSERVABILITY_PORT },
    });

    expect(
      parseCliOptions([
        "--launch-mode",
        "settings",
        "--flash-plugin-path",
        "--flash-version=   ",
        "--another-flag",
      ]),
    ).toEqual({});
  });

  it("parses observability port overrides and falls back on invalid ports", () => {
    expect(parseCliOptions(["--obs=12_345"])).toEqual({
      obs: { port: DEFAULT_OBSERVABILITY_PORT },
    });

    expect(parseCliOptions(["--obs=12345"])).toEqual({
      obs: { port: 12_345 },
    });

    expect(parseCliOptions(["--obs", "12346"])).toEqual({
      obs: { port: 12_346 },
    });

    expect(parseCliOptions(["--obs=0"])).toEqual({
      obs: { port: DEFAULT_OBSERVABILITY_PORT },
    });

    expect(parseCliOptions(["--obs=65536"])).toEqual({
      obs: { port: DEFAULT_OBSERVABILITY_PORT },
    });
  });
});
