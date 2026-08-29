import { promises as fs } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { layer as filesystemLayer } from "../filesystem/DesktopFileSystemNode";
import {
  SCRIPT_WORKSPACE_CONFIG,
  ScriptWorkspace,
  layer,
} from "./ScriptWorkspace";
import { resolveScriptWorkspacePaths } from "./ScriptWorkspacePaths";

const directories: string[] = [];

const write = async (path: string, source: string): Promise<void> => {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, source, "utf8");
};

const makeFixture = async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "lucent-script-workspace-"));
  directories.push(root);
  const assetsDir = join(root, "distribution", "assets");
  const templatePath = join(
    root,
    "distribution",
    "docs",
    "public",
    "script-api.d.ts",
  );
  const workspaceDir = join(root, "Documents", "Lucent");
  await write(templatePath, "declare module 'lucent' {}\n");
  const environment = DesktopEnvironment.of({
    appDataDir: join(root, "app-data"),
    assetsDir,
    isDev: true,
    platform: process.platform,
    workspaceDir,
  });
  const testLayer = layer.pipe(
    Layer.provide(Layer.succeed(DesktopEnvironment, environment)),
    Layer.provide(filesystemLayer),
  );
  const initialize = () =>
    Effect.gen(function* () {
      const workspace = yield* ScriptWorkspace;
      yield* workspace.initialize;
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  return {
    initialize,
    paths: resolveScriptWorkspacePaths(workspaceDir),
    workspaceDir,
  };
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe("ScriptWorkspace", () => {
  it("creates the package workspace, editor config, and API types", async () => {
    const fixture = await makeFixture();
    await fixture.initialize();

    await expect(fs.stat(fixture.paths.scriptsDir)).resolves.toMatchObject({});
    await expect(fs.stat(fixture.paths.packagesDir)).resolves.toMatchObject({});
    await expect(
      fs.readFile(join(fixture.workspaceDir, "jsconfig.json"), "utf8"),
    ).resolves.toBe(SCRIPT_WORKSPACE_CONFIG);
    await expect(
      fs.readFile(join(fixture.workspaceDir, "script-api.d.ts"), "utf8"),
    ).resolves.toBe("declare module 'lucent' {}\n");
  });

  it("does not overwrite user-owned workspace files", async () => {
    const fixture = await makeFixture();
    const configPath = join(fixture.workspaceDir, "jsconfig.json");
    const typesPath = join(fixture.workspaceDir, "script-api.d.ts");
    await Promise.all([
      write(configPath, "user config\n"),
      write(typesPath, "user types\n"),
    ]);

    await fixture.initialize();

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(
      "user config\n",
    );
    await expect(fs.readFile(typesPath, "utf8")).resolves.toBe("user types\n");
  });
});
