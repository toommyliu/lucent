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
        "--launch-mode",
        "account-manager",
      ],
      { cwd },
    );
    expect(parsed).toEqual({
      flashPluginPath: join(cwd, "PepperFlashPlayer.plugin"),
      launchMode: "account-manager",
    });

    expect(
      parseCliOptions([
        "--launch-mode",
        "settings",
        "--flash-plugin-path",
        "--another-flag",
      ]),
    ).toEqual({});
  });
});
