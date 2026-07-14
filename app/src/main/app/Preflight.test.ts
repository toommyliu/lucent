import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  appendSwitch: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    commandLine: {
      appendSwitch: electronMock.appendSwitch,
    },
  },
}));

import { configureFlashStartup } from "./Preflight";

const temporaryDirectories: string[] = [];

afterEach(() => {
  electronMock.appendSwitch.mockReset();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const makeEnvironmentConfig = () => {
  const directory = mkdtempSync(join(tmpdir(), "lucent-preflight-"));
  const flashPluginPath = join(directory, "PepperFlashPlayer.plugin");
  temporaryDirectories.push(directory);
  writeFileSync(flashPluginPath, "");

  return {
    config: {
      appDataDir: join(directory, "app-data"),
      assetsDir: join(directory, "assets"),
      flashPluginPathOverride: flashPluginPath,
      isDev: true,
      platform: "darwin" as const,
      workspaceDir: join(directory, "workspace"),
    },
    flashPluginPath,
  };
};

describe("main preflight", () => {
  it("configures the optional Flash version with the plugin path", () => {
    const { config, flashPluginPath } = makeEnvironmentConfig();

    expect(configureFlashStartup(config, "32.0.0.371").status).toBe(
      "configured",
    );
    expect(electronMock.appendSwitch.mock.calls).toEqual([
      ["ppapi-flash-path", flashPluginPath],
      ["ppapi-flash-version", "32.0.0.371"],
    ]);
  });

  it("leaves the Flash version unset when it is omitted", () => {
    const { config, flashPluginPath } = makeEnvironmentConfig();

    expect(configureFlashStartup(config).status).toBe("configured");
    expect(electronMock.appendSwitch).toHaveBeenCalledOnce();
    expect(electronMock.appendSwitch).toHaveBeenCalledWith(
      "ppapi-flash-path",
      flashPluginPath,
    );
  });
});
