import { join } from "path";

import { describe, expect, it } from "@effect/vitest";

import {
  resolveFlashTrustRootPath,
  resolvePepperFlashPluginPath,
} from "./FlashPaths";

const pluginPathFor = (platform: NodeJS.Platform) =>
  resolvePepperFlashPluginPath({ platform, workspaceDir: "/workspace" });

describe("FlashPaths", () => {
  it("resolves the default Pepper Flash plugin for each desktop platform", () => {
    expect(pluginPathFor("darwin")).toBe(
      join("/workspace", "PepperFlashPlayer.plugin"),
    );
    expect(pluginPathFor("win32")).toBe(
      join("/workspace", "pepflashplayer.dll"),
    );
    expect(pluginPathFor("linux")).toBe(
      join("/workspace", "libpepflashplayer.so"),
    );
  });

  it("prefers an explicit plugin override", () => {
    expect(
      resolvePepperFlashPluginPath({
        override: "/custom/pepflashplayer.dll",
        platform: "win32",
        workspaceDir: "/workspace",
      }),
    ).toBe("/custom/pepflashplayer.dll");
  });

  it("resolves Flash trust storage beneath app data", () => {
    expect(resolveFlashTrustRootPath("/internal/Lucent")).toBe(
      join(
        "/internal/Lucent",
        "Pepper Data",
        "Shockwave Flash",
        "WritableRoot",
      ),
    );
  });
});
