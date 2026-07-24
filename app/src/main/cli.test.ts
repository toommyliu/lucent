import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";

import { parseCliOptions } from "./cli";

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
        "--debug",
      ],
      { cwd },
    );
    expect(parsed).toEqual({
      debug: true,
      flashPluginPath: join(cwd, "PepperFlashPlayer.plugin"),
      flashVersion: "32.0.0.371",
      launchMode: "account-manager",
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

  it("only enables debug mode with the boolean debug flag", () => {
    expect(parseCliOptions(["--debug"])).toEqual({ debug: true });
    expect(parseCliOptions(["--debug=10637"])).toEqual({});
    expect(parseCliOptions(["--obs"])).toEqual({});
    expect(parseCliOptions(["--obs=10637"])).toEqual({});
    expect(parseCliOptions(["--obs", "10637"])).toEqual({});
  });
});
