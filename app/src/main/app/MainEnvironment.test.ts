import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  makeMainEnvironment,
  resolveUserDataPath,
  resolveWorkspaceHome,
} from "./MainEnvironment";

describe("main environment", () => {
  it("resolves workspace home from documents by default", () => {
    expect(
      resolveWorkspaceHome({
        argv: [],
        env: {},
        documentsPath: "/Users/example/Documents",
      }),
    ).toBe("/Users/example/Documents/lucent");
  });

  it("falls back to the legacy capitalized documents workspace when it already exists", () => {
    const documentsPath = "/Users/example/Documents";

    expect(
      resolveWorkspaceHome({
        argv: [],
        env: {},
        documentsPath,
        pathExists: (path) => path === join(documentsPath, "Lucent"),
      }),
    ).toBe(join(documentsPath, "Lucent"));
  });

  it("prefers the canonical lowercase documents workspace when both casings exist", () => {
    const documentsPath = "/Users/example/Documents";

    expect(
      resolveWorkspaceHome({
        argv: [],
        env: {},
        documentsPath,
        pathExists: (path) =>
          path === join(documentsPath, "Lucent") ||
          path === join(documentsPath, "lucent"),
      }),
    ).toBe(join(documentsPath, "lucent"));
  });

  it("resolves workspace home from LUCENT_HOME", () => {
    expect(
      resolveWorkspaceHome({
        argv: [],
        env: { LUCENT_HOME: "/tmp/lucent-workspace" },
        documentsPath: "/Users/example/Documents",
      }),
    ).toBe("/tmp/lucent-workspace");
  });

  it("resolves workspace home from --lucent-home before LUCENT_HOME", () => {
    expect(
      resolveWorkspaceHome({
        argv: ["lucent", "--lucent-home", "/tmp/from-flag"],
        env: { LUCENT_HOME: "/tmp/from-env" },
        documentsPath: "/Users/example/Documents",
      }),
    ).toBe("/tmp/from-flag");

    expect(
      resolveWorkspaceHome({
        argv: ["lucent", "--lucent-home=/tmp/from-equals"],
        env: { LUCENT_HOME: "/tmp/from-env" },
        documentsPath: "/Users/example/Documents",
      }),
    ).toBe("/tmp/from-equals");
  });

  it("uses branded app-data directories without a legacy fallback", () => {
    const devPath = resolveUserDataPath({
      isDev: true,
      platform: "darwin",
    });
    const productionPath = resolveUserDataPath({
      isDev: false,
      platform: "darwin",
    });

    expect(devPath).toContain("Application Support");
    expect(devPath).toContain("lucent-dev");
    expect(productionPath).toContain("Application Support");
    expect(productionPath).toContain("lucent");
  });

  it("derives named app-data and workspace paths from one config", () => {
    const env = makeMainEnvironment({
      appDataDir: "/tmp/lucent-app-data",
      workspaceDir: "/tmp/lucent-workspace",
      assetsDir: "/tmp/assets",
      rendererDir: "/tmp/renderer",
      preloadPath: "/tmp/preload.js",
      isDev: false,
      isDarwin: true,
      isWin: false,
      isLinux: false,
    });

    expect(env.logsDir).toBe(join("/tmp/lucent-app-data", "logs"));
    expect(env.appIconPath).toBe(join("/tmp/assets", "icon.png"));
    expect(env.flashRootPath).toBe(
      join(
        "/tmp/lucent-app-data",
        "Pepper Data",
        "Shockwave Flash",
        "WritableRoot",
      ),
    );
    expect(env.flashPluginPath).toBe(
      join("/tmp/lucent-workspace", "PepperFlashPlayer.plugin"),
    );
    expect(env.armyConfigPath("farm")).toBe(
      join("/tmp/lucent-workspace", "army", "farm.yaml"),
    );
    expect(env.scriptsDir).toBe(join("/tmp/lucent-workspace", "scripts"));
  });

  it("uses the dev branded icon path for dev builds", () => {
    const env = makeMainEnvironment({
      appDataDir: "/tmp/lucent-app-data",
      workspaceDir: "/tmp/lucent-workspace",
      assetsDir: "/tmp/assets",
      rendererDir: "/tmp/renderer",
      preloadPath: "/tmp/preload.js",
      isDev: true,
      isDarwin: true,
      isWin: false,
      isLinux: false,
    });

    expect(env.appIconPath).toBe(join("/tmp/assets", "icon-dev.png"));
  });

  it("uses configured Flash plugin path override before platform defaults", () => {
    const env = makeMainEnvironment({
      appDataDir: "/tmp/lucent-app-data",
      workspaceDir: "/tmp/lucent-workspace",
      assetsDir: "/tmp/assets",
      rendererDir: "/tmp/renderer",
      preloadPath: "/tmp/preload.js",
      flashPluginPathOverride: "/opt/pepper/libpepflashplayer.so",
      isDev: false,
      isDarwin: false,
      isWin: false,
      isLinux: true,
    });

    expect(env.flashPluginPath).toBe("/opt/pepper/libpepflashplayer.so");
  });

  it("normalizes tilde workspace paths", () => {
    vi.stubEnv("HOME", "/Users/example");
    try {
      expect(
        resolveWorkspaceHome({
          argv: ["lucent", "--lucent-home", "~/aqw"],
          env: {},
          documentsPath: "/Users/example/Documents",
        }),
      ).toBe("/Users/example/aqw");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
