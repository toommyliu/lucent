import { promises as fs } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ElectronApp } from "../electron/ElectronApp";
import { hashDirectory } from "./ScriptPackageFileSystem";
import {
  discoverScriptCatalog,
  inspectScriptPackageDirectory,
  layer as scriptPackageCatalogLayer,
  ScriptPackageCatalog,
} from "./ScriptPackageCatalog";
import {
  type ManagedScriptPackage,
  ScriptPackageState,
} from "./ScriptPackageState";

const directories: string[] = [];

const makeWorkspace = async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "lucent-script-catalog-"));
  directories.push(root);
  const scriptsDir = join(root, "scripts");
  const packagesDir = join(root, "packages");
  await Promise.all([
    fs.mkdir(scriptsDir, { recursive: true }),
    fs.mkdir(packagesDir, { recursive: true }),
  ]);
  return { packagesDir, root, scriptsDir };
};

const write = async (path: string, source: string): Promise<void> => {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, source, "utf8");
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe("discoverScriptCatalog", () => {
  it("discovers every loose script without assigning package meaning to its folders", async () => {
    const workspace = await makeWorkspace();
    await Promise.all([
      write(join(workspace.scriptsDir, "farm.js"), ""),
      write(join(workspace.scriptsDir, "packages", "nested.cjs"), ""),
      write(
        join(workspace.scriptsDir, "packages", "package.json"),
        '{"name":"ignored"}',
      ),
      write(join(workspace.scriptsDir, "notes.txt"), ""),
    ]);

    const discovery = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });

    expect(
      discovery.catalog.scripts.map((script) => script.relativePath),
    ).toEqual(["farm.js", "packages/nested.cjs"]);
    expect(
      discovery.catalog.scripts.every(
        (script) => script.reference.kind === "loose",
      ),
    ).toBe(true);
  });

  it("uses a package directory's complete relative path as its exact name", async () => {
    const workspace = await makeWorkspace();
    const packageRoot = join(workspace.packagesDir, "@a", "b", "c", "d");
    await Promise.all([
      write(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name: "@a/b/c/d",
          main: "index.cjs",
          lucent: { version: ">=1.0.0 <2.0.0" },
        }),
      ),
      write(join(packageRoot, "index.cjs"), "exports.value = 1"),
      write(join(packageRoot, "lib", "helper.js"), ""),
      write(join(packageRoot, "scripts", "farm.js"), ""),
      write(join(packageRoot, "scripts", "nested", "quest.cjs"), ""),
    ]);

    const discovery = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });

    expect(discovery.catalog.packages).toHaveLength(1);
    expect(discovery.catalog.packages[0]).toMatchObject({
      status: "valid",
      name: "@a/b/c/d",
      compatibility: { status: "compatible" },
    });
    expect(
      discovery.catalog.scripts.map((script) => script.relativePath),
    ).toEqual(["farm.js", "nested/quest.cjs"]);
    expect(discovery.catalog.scripts[0]?.reference).toEqual({
      kind: "package",
      packageName: "@a/b/c/d",
      path: "scripts/farm.js",
    });
    expect(discovery.packages.get("@a/b/c/d")?.files).toHaveLength(4);
  });

  it("stops at the first package candidate and keeps invalid candidates diagnostic-only", async () => {
    const workspace = await makeWorkspace();
    const invalidRoot = join(workspace.packagesDir, "namespace", "invalid");
    const nestedRoot = join(invalidRoot, "nested");
    await Promise.all([
      write(join(invalidRoot, "package.json"), '{"name":"wrong-directory"}'),
      write(join(invalidRoot, "scripts", "hidden.js"), ""),
      write(
        join(nestedRoot, "package.json"),
        '{"name":"namespace/invalid/nested"}',
      ),
      write(join(nestedRoot, "scripts", "also-hidden.js"), ""),
    ]);

    const discovery = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });

    expect(discovery.catalog.packages).toHaveLength(1);
    expect(discovery.catalog.packages[0]).toMatchObject({
      status: "invalid",
      name: "wrong-directory",
      path: invalidRoot,
    });
    expect(discovery.catalog.scripts).toEqual([]);
    expect(discovery.packages.size).toBe(0);
  });

  it("blocks incompatible packages but treats malformed ranges as warnings", async () => {
    const workspace = await makeWorkspace();
    await Promise.all([
      write(
        join(workspace.packagesDir, "future", "package.json"),
        '{"name":"future","lucent":{"version":">=9.0.0"}}',
      ),
      write(join(workspace.packagesDir, "future", "scripts", "run.js"), ""),
      write(
        join(workspace.packagesDir, "unknown", "package.json"),
        '{"name":"unknown","lucent":{"version":"definitely-not-semver"}}',
      ),
      write(join(workspace.packagesDir, "unknown", "scripts", "run.js"), ""),
    ]);

    const discovery = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });
    const valid = discovery.catalog.packages.filter(
      (entry) => entry.status === "valid",
    );
    expect(
      valid.find((entry) => entry.name === "future")?.compatibility.status,
    ).toBe("incompatible");
    expect(valid.find((entry) => entry.name === "unknown")).toMatchObject({
      compatibility: { status: "unknown" },
      warning: expect.stringContaining(
        "The Lucent version requirement is invalid",
      ),
    });
  });

  it("accepts semver dependency ranges and keeps compatible cycles ready", async () => {
    const workspace = await makeWorkspace();
    const firstRoot = join(workspace.packagesDir, "first");
    const secondRoot = join(workspace.packagesDir, "second");
    await Promise.all([
      write(
        join(firstRoot, "package.json"),
        JSON.stringify({
          name: "first",
          version: "1.0.0",
          lucent: { dependencies: { second: "^2.0.0" } },
        }),
      ),
      write(join(firstRoot, "index.js"), "exports.first = true;"),
      write(
        join(secondRoot, "package.json"),
        JSON.stringify({
          name: "second",
          version: "2.3.0",
          lucent: { dependencies: { first: "*" } },
        }),
      ),
      write(join(secondRoot, "index.js"), "exports.second = true;"),
    ]);

    const discovery = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });

    expect(discovery.packages.get("first")?.dependencyStatus).toEqual({
      status: "ready",
    });
    expect(discovery.packages.get("second")?.dependencyStatus).toEqual({
      status: "ready",
    });
  });

  it("blocks missing, mismatched, unversioned, and transitive dependencies", async () => {
    const workspace = await makeWorkspace();
    const manifests = [
      {
        name: "missing-consumer",
        version: "1.0.0",
        lucent: { dependencies: { absent: "1.0.0" } },
      },
      {
        name: "mismatch-consumer",
        version: "1.0.0",
        lucent: { dependencies: { versioned: "^2.0.0" } },
      },
      {
        name: "unversioned-consumer",
        version: "1.0.0",
        lucent: { dependencies: { unversioned: "*" } },
      },
      {
        name: "transitive-consumer",
        version: "1.0.0",
        lucent: { dependencies: { "missing-consumer": "1.0.0" } },
      },
      { name: "versioned", version: "1.5.0" },
      { name: "unversioned" },
    ] as const;
    await Promise.all(
      manifests.flatMap((manifest) => {
        const root = join(workspace.packagesDir, manifest.name);
        return [
          write(join(root, "package.json"), JSON.stringify(manifest)),
          write(join(root, "index.js"), "exports.value = true;"),
        ];
      }),
    );

    const discovery = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });

    expect(
      discovery.packages.get("missing-consumer")?.dependencyStatus,
    ).toMatchObject({
      status: "blocked",
      issues: [{ reason: "missing", packageName: "absent" }],
    });
    expect(
      discovery.packages.get("mismatch-consumer")?.dependencyStatus,
    ).toMatchObject({
      status: "blocked",
      issues: [{ reason: "version-mismatch", installedVersion: "1.5.0" }],
    });
    expect(
      discovery.packages.get("unversioned-consumer")?.dependencyStatus,
    ).toMatchObject({
      status: "blocked",
      issues: [{ reason: "version-unavailable" }],
    });
    expect(
      discovery.packages.get("transitive-consumer")?.dependencyStatus,
    ).toMatchObject({
      status: "blocked",
      issues: [{ reason: "unavailable", packageName: "missing-consumer" }],
    });
  });

  it("derives verified and modified integrity from the app-owned baseline", async () => {
    const workspace = await makeWorkspace();
    const packageRoot = join(workspace.packagesDir, "tools");
    await Promise.all([
      write(join(packageRoot, "package.json"), '{"name":"tools"}'),
      write(join(packageRoot, "index.js"), "exports.value = 1"),
    ]);
    const managed: ManagedScriptPackage = {
      files: await hashDirectory(packageRoot),
      installedAt: new Date(0).toISOString(),
      name: "tools",
      source: {
        repositoryUrl: "https://github.com/example/tools",
        resolvedCommit: "abc123",
      },
    };

    const verified = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      managedPackages: [managed],
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });
    expect(verified.catalog.packages[0]).toMatchObject({
      integrity: "verified",
    });

    await write(join(packageRoot, "index.js"), "exports.value = 2");
    const modified = await discoverScriptCatalog({
      currentVersion: "1.2.3",
      managedPackages: [managed],
      packagesDir: workspace.packagesDir,
      scriptsDir: workspace.scriptsDir,
    });
    expect(modified.catalog.packages[0]).toMatchObject({
      integrity: "modified",
    });
  });
});

describe("ScriptPackageCatalog", () => {
  it.effect(
    "scans lazily once and refreshes only when explicitly requested",
    () =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(makeWorkspace);
        yield* Effect.promise(() =>
          write(join(workspace.scriptsDir, "first.js"), ""),
        );
        let scanCount = 0;
        const environment = DesktopEnvironment.of({
          appDataDir: join(workspace.root, "app-data"),
          assetsDir: join(workspace.root, "assets"),
          isDev: true,
          platform: "darwin",
          workspaceDir: workspace.root,
        });
        const app = ElectronApp.of({
          appendCommandLineSwitch: () => Effect.void,
          exit: () => Effect.void,
          getAppMetrics: Effect.succeed([]),
          getVersion: Effect.succeed("1.0.0"),
          isPackaged: Effect.succeed(false),
          on: () => Effect.succeed(() => undefined),
          quit: Effect.void,
          relaunch: Effect.void,
          whenReady: Effect.void,
        });
        const state = ScriptPackageState.of({
          get: () =>
            Effect.sync((): ManagedScriptPackage | undefined => undefined),
          getAll: Effect.sync(() => {
            scanCount += 1;
            return [];
          }),
          remove: () => Effect.void,
          save: () => Effect.void,
        });
        const testLayer = scriptPackageCatalogLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(DesktopEnvironment, environment),
              Layer.succeed(ElectronApp, app),
              Layer.succeed(ScriptPackageState, state),
            ),
          ),
        );

        yield* Effect.gen(function* () {
          const catalog = yield* ScriptPackageCatalog;
          const [first, concurrent] = yield* Effect.all([
            catalog.getOverview,
            catalog.getOverview,
          ]);
          expect(first.scriptCount).toBe(1);
          expect(concurrent.revision).toBe(first.revision);
          expect(scanCount).toBe(1);

          yield* Effect.promise(() =>
            write(join(workspace.scriptsDir, "second.js"), ""),
          );
          expect((yield* catalog.getOverview).scriptCount).toBe(1);
          expect(scanCount).toBe(1);

          const refreshed = yield* catalog.refresh;
          expect(refreshed.scriptCount).toBe(2);
          expect(scanCount).toBe(2);
          const page = yield* catalog.getPage({
            limit: 128,
            offset: 0,
            query: "second",
            revision: refreshed.revision,
          });
          expect(page.total).toBe(1);
          expect(page.entries[0]?.relativePath).toBe("second.js");

          const sourceRoot = join(workspace.root, "staged-tools");
          const rootPath = join(workspace.packagesDir, "tools");
          yield* Effect.promise(() =>
            Promise.all([
              write(
                join(sourceRoot, "package.json"),
                JSON.stringify({ name: "tools" }),
              ),
              write(join(sourceRoot, "scripts", "tool.js"), ""),
            ]),
          );
          const inspected = yield* Effect.promise(() =>
            inspectScriptPackageDirectory(sourceRoot, "tools"),
          );
          yield* Effect.promise(() => fs.rename(sourceRoot, rootPath));
          const managed: ManagedScriptPackage = {
            files: yield* Effect.promise(() => hashDirectory(rootPath)),
            installedAt: new Date(0).toISOString(),
            name: "tools",
            source: {
              repositoryUrl: "https://github.com/example/tools",
              resolvedCommit: "abc123",
            },
          };
          const replaced = yield* catalog.replacePackage({
            inspected,
            managed,
            rootPath,
            sourceRoot,
          });
          expect(replaced.scriptCount).toBe(3);
          expect(scanCount).toBe(2);
          expect(
            (yield* catalog.getPage({
              limit: 128,
              offset: 0,
              query: "tool",
              revision: replaced.revision,
            })).entries[0]?.reference,
          ).toEqual({
            kind: "package",
            packageName: "tools",
            path: "scripts/tool.js",
          });

          const removed = yield* catalog.removePackage("tools");
          expect(removed.scriptCount).toBe(2);
          expect(scanCount).toBe(2);
        }).pipe(Effect.provide(testLayer));
      }),
  );
});
