import { describe, expect, it } from "@effect/vitest";

import {
  makeDesktopEnvironment,
  resolveWorkspaceHome,
} from "./DesktopEnvironment";

const environmentFor = (platform: NodeJS.Platform) =>
  makeDesktopEnvironment({
    appDataDir: "/internal/Lucent",
    assetsDir: "/assets",
    isDev: true,
    platform,
    rendererDir: "/renderer",
    workspaceDir: "/workspace",
  });

describe("DesktopEnvironment", () => {
  it("resolves hybrid app data and fixed workspace paths", () => {
    const workspaceDir = resolveWorkspaceHome({
      documentsPath: "/Users/example/Documents",
    });
    const env = makeDesktopEnvironment({
      appDataDir: "/internal/Lucent",
      assetsDir: "/assets",
      flashPluginPathOverride: "/custom/pepflashplayer.dll",
      isDev: true,
      platform: "win32",
      rendererDir: "/renderer",
      workspaceDir,
    });

    expect(workspaceDir).toBe("/Users/example/Documents/Lucent");
    expect(env.settingsPath).toBe("/internal/Lucent/settings.json");
    expect(env.releaseCachePath).toBe("/internal/Lucent/release-cache.json");
    expect(env.logFilePath).toBe("/internal/Lucent/logs/lucent.log");
    expect(env.flashPluginPath).toBe("/custom/pepflashplayer.dll");
    expect(env.gameHtmlPath).toBe("/renderer/game/index.html");
  });

  it("resolves default Pepper Flash plugin paths per platform", () => {
    expect(environmentFor("darwin").flashPluginPath).toBe(
      "/workspace/PepperFlashPlayer.plugin",
    );
    expect(environmentFor("win32").flashPluginPath).toBe(
      "/workspace/pepflashplayer.dll",
    );
    expect(environmentFor("linux").flashPluginPath).toBe(
      "/workspace/libpepflashplayer.so",
    );
  });
});
