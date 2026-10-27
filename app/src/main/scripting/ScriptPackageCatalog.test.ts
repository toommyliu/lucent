import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import { layer as nodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, expect, it, layer } from "@effect/vitest";
import { vi } from "vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ElectronApp } from "../electron/ElectronApp";
import {
  desktopLogRecord,
  type DesktopLogRecord,
} from "../../shared/logRecord";
import { hashDirectory } from "./ScriptPackageFileSystem";
import {
  discoverScriptCatalog,
  replaceDiscoveredPackage,
} from "./ScriptCatalogDiscovery";
import { inspectScriptPackageDirectory } from "./ScriptPackageInspection";
import { makeScriptSourceRegistry } from "./ScriptSourceRegistry";
import {
  layer as scriptPackageCatalogLayer,
  ScriptPackageCatalog,
} from "./ScriptPackageCatalog";
import {
  type ManagedScriptPackage,
  ScriptPackageState,
} from "./ScriptPackageState";

vi.mock("electron", () => ({ app: {} }));

const directories: string[] = [];
const epoch = new Date(0).toISOString();
const writeManifest = (path: string, value: unknown) =>
  write(path, JSON.stringify(value));

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
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

layer(nodeFileSystemLayer)("discoverScriptCatalog", (it) => {
  it.effect.each([
    [undefined, undefined, "This folder does not contain a package.json."],
    ["{", undefined, "package.json contains invalid JSON."],
    ['{"name":""}', undefined, "package.json contains invalid fields."],
    [
      '{"name":"../unsafe"}',
      "../unsafe",
      expect.stringContaining(
        "a safe, case-sensitive, non-reserved package name",
      ),
    ],
    [
      '{"name":"tools","main":"../escape.js"}',
      "tools",
      "The package.json main path is invalid.",
    ],
  ] as const)(
    "preserves diagnostics for manifest %s",
    ([source, name, diagnostic]) =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
        const rootPath = join(workspace.packagesDir, "tools-folder");
        yield* Effect.promise(() => fs.mkdir(rootPath));
        if (source !== undefined) {
          yield* Effect.promise(() =>
            write(join(rootPath, "package.json"), source),
          );
        }

        const discovery = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));

        expect(discovery.catalog.packages).toEqual([
          {
            status: "invalid",
            diagnostic,
            ...(name === undefined ? {} : { name }),
            path: rootPath,
          },
        ]);
      }),
  );

  it.effect.each([
    [undefined, true, undefined],
    [undefined, false, undefined],
    ["^1.0.0", true, undefined],
    ["^1.0.0", false, "The package's main file was not found: index.js."],
    ["^9.0.0", false, "The package's main file was not found: index.js."],
    ["invalid", false, "The Lucent version requirement is invalid: invalid."],
  ] as const)(
    "keeps scanned and replaced rows equivalent for requirement %s and main present %s",
    ([requiredVersion, hasMain, warning]) =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
        const sourceRoot = join(workspace.root, "staged-tools");
        const rootPath = join(workspace.packagesDir, "tools-folder");
        const initial = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));
        yield* Effect.promise(() =>
          Promise.all([
            writeManifest(join(sourceRoot, "package.json"), {
              name: "@author/tools",
              description: "Tools",
              version: "2.0.0",
              lucent: { version: requiredVersion },
            }),
            ...(hasMain ? [write(join(sourceRoot, "index.js"), "")] : []),
            write(join(sourceRoot, "lib", "helper.cjs"), ""),
            write(join(sourceRoot, "scripts", "nested", "run.js"), ""),
            write(join(sourceRoot, "scripts-other", "hidden.js"), ""),
          ]),
        );
        const inspected = yield* inspectScriptPackageDirectory(sourceRoot);
        yield* Effect.promise(() => fs.rename(sourceRoot, rootPath));
        const managed: ManagedScriptPackage = {
          directory: "tools-folder",
          files: yield* hashDirectory(rootPath),
          installedAt: epoch,
          name: "@author/tools",
          source: {
            kind: "repository",
            repositoryUrl: "https://github.com/example/tools",
            resolvedCommit: "abc123",
          },
          update: { status: "unchecked" },
        };

        const replaced = replaceDiscoveredPackage(
          initial,
          { inspected, managed, rootPath, sourceRoot },
          "1.2.3",
        );
        const scanned = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          managedPackages: [managed],
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));

        expect(replaced).toEqual(scanned);
        expect(
          scanned.catalog.packages.find((entry) => entry.status === "valid")
            ?.warning,
        ).toBe(warning);
        expect(scanned.catalog.scripts).toEqual([
          {
            name: "run.js",
            packageName: "@author/tools",
            path: join(rootPath, "scripts", "nested", "run.js"),
            reference: {
              kind: "package",
              packageName: "@author/tools",
              path: "scripts/nested/run.js",
            },
            relativePath: "nested/run.js",
          },
        ]);
        expect(
          scanned.packages.get("@author/tools")?.modules.get("lib/helper.cjs"),
        ).toBe(join(rootPath, "lib", "helper.cjs"));
      }),
  );

  it.effect(
    "discovers every loose script without assigning package meaning to its folders",
    () =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
        yield* Effect.promise(() =>
          Promise.all([
            write(join(workspace.scriptsDir, "farm.js"), ""),
            write(join(workspace.scriptsDir, "packages", "nested.cjs"), ""),
            write(
              join(workspace.scriptsDir, "packages", "package.json"),
              '{"name":"ignored"}',
            ),
            write(join(workspace.scriptsDir, "notes.txt"), ""),
          ]),
        );

        const discovery = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));

        expect(
          discovery.catalog.scripts.map((script) => script.relativePath),
        ).toEqual(["farm.js", "packages/nested.cjs"]);
        expect(
          discovery.catalog.scripts.every(
            (script) => script.reference.kind === "loose",
          ),
        ).toBe(true);
      }),
  );

  it.effect("reads a package name independently from its folder", () =>
    Effect.gen(function* () {
      const workspace = yield* Effect.promise(() => makeWorkspace());
      const packageRoot = join(workspace.packagesDir, "daily-package");
      yield* Effect.promise(() =>
        Promise.all([
          writeManifest(join(packageRoot, "package.json"), {
            name: "@a/b/c/d",
            main: "index.cjs",
            lucent: { version: ">=1.0.0 <2.0.0" },
          }),
          write(join(packageRoot, "index.cjs"), "exports.value = 1"),
          write(join(packageRoot, "lib", "helper.js"), ""),
          write(join(packageRoot, "scripts", "farm.js"), ""),
          write(join(packageRoot, "scripts", "nested", "quest.cjs"), ""),
        ]),
      );

      const discovery = yield* discoverScriptCatalog({
        currentVersion: "1.2.3",
        packagesDir: workspace.packagesDir,
        scriptsDir: workspace.scriptsDir,
      }).pipe(Effect.map((report) => report.discovery));

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
      expect(discovery.packages.get("@a/b/c/d")?.modules).toEqual(
        new Map([
          ["index.cjs", join(packageRoot, "index.cjs")],
          ["lib/helper.js", join(packageRoot, "lib", "helper.js")],
          ["scripts/farm.js", join(packageRoot, "scripts", "farm.js")],
          [
            "scripts/nested/quest.cjs",
            join(packageRoot, "scripts", "nested", "quest.cjs"),
          ],
        ]),
      );
      expect(discovery.packages.get("@a/b/c/d")?.directory).toBe(
        "daily-package",
      );
    }),
  );

  it.effect("does not discover packages below a direct child folder", () =>
    Effect.gen(function* () {
      const workspace = yield* Effect.promise(() => makeWorkspace());
      const containerRoot = join(workspace.packagesDir, "namespace");
      const nestedRoot = join(containerRoot, "nested");
      yield* Effect.promise(() =>
        Promise.all([
          write(
            join(nestedRoot, "package.json"),
            '{"name":"namespace/nested"}',
          ),
          write(join(nestedRoot, "scripts", "hidden.js"), ""),
        ]),
      );

      const discovery = yield* discoverScriptCatalog({
        currentVersion: "1.2.3",
        packagesDir: workspace.packagesDir,
        scriptsDir: workspace.scriptsDir,
      }).pipe(Effect.map((report) => report.discovery));

      expect(discovery.catalog.packages).toHaveLength(1);
      expect(discovery.catalog.packages[0]).toMatchObject({
        status: "invalid",
        path: containerRoot,
      });
      expect(discovery.catalog.scripts).toEqual([]);
      expect(discovery.packages.size).toBe(0);
    }),
  );

  it.effect("rejects duplicate package names", () =>
    Effect.gen(function* () {
      const workspace = yield* Effect.promise(() => makeWorkspace());
      yield* Effect.promise(() =>
        Promise.all([
          write(
            join(workspace.packagesDir, "first-folder", "package.json"),
            '{"name":"shared-name"}',
          ),
          write(
            join(workspace.packagesDir, "second-folder", "package.json"),
            '{"name":"shared-name"}',
          ),
        ]),
      );

      const discovery = yield* discoverScriptCatalog({
        currentVersion: "1.2.3",
        packagesDir: workspace.packagesDir,
        scriptsDir: workspace.scriptsDir,
      }).pipe(Effect.map((report) => report.discovery));

      expect(discovery.catalog.packages).toHaveLength(2);
      expect(
        discovery.catalog.packages.every(
          (entry) =>
            entry.status === "invalid" &&
            entry.diagnostic.includes("More than one package folder"),
        ),
      ).toBe(true);
      expect(discovery.packages.has("shared-name")).toBe(false);
    }),
  );

  it.effect("classifies incompatible and malformed minimum versions", () =>
    Effect.gen(function* () {
      const workspace = yield* Effect.promise(() => makeWorkspace());
      yield* Effect.promise(() =>
        Promise.all([
          write(
            join(workspace.packagesDir, "future", "package.json"),
            '{"name":"future","lucent":{"version":">=9.0.0"}}',
          ),
          write(join(workspace.packagesDir, "future", "scripts", "run.js"), ""),
          write(
            join(workspace.packagesDir, "unknown", "package.json"),
            '{"name":"unknown","lucent":{"version":"definitely-not-semver"}}',
          ),
          write(
            join(workspace.packagesDir, "unknown", "scripts", "run.js"),
            "",
          ),
        ]),
      );

      const discovery = yield* discoverScriptCatalog({
        currentVersion: "1.2.3",
        packagesDir: workspace.packagesDir,
        scriptsDir: workspace.scriptsDir,
      }).pipe(Effect.map((report) => report.discovery));
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
    }),
  );

  it.effect.each([
    [">=0.0.1 <0.1.0", "0.0.3-beta.1", "compatible"],
    ["*", "0.0.3-beta.1", "compatible"],
    ["^0.0.3", "0.0.3-beta.1", "compatible"],
    [">=0.0.3", "0.0.3-beta.1", "incompatible"],
    [">=0.0.1 <0.1.0-0", "0.1.0-beta.1", "incompatible"],
    [">=0.0.3-beta.2 <0.1.0", "0.0.3-beta.1", "incompatible"],
    [">=0.0.3-beta.2 <0.1.0", "0.0.3-beta.3", "compatible"],
  ] as const)(
    "checks prerelease app compatibility for %s against %s",
    ([requiredVersion, currentVersion, status]) =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
        yield* Effect.promise(() =>
          writeManifest(join(workspace.packagesDir, "tools", "package.json"), {
            name: "tools",
            lucent: { version: requiredVersion },
          }),
        );

        const discovery = yield* discoverScriptCatalog({
          currentVersion,
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));

        expect(discovery.packages.get("tools")?.compatibility).toEqual({
          status,
          currentVersion,
          requiredVersion,
        });
      }),
  );

  it.effect(
    "accepts semver dependency ranges and keeps compatible cycles ready",
    () =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
        const firstRoot = join(workspace.packagesDir, "first");
        const secondRoot = join(workspace.packagesDir, "second");
        yield* Effect.promise(() =>
          Promise.all([
            writeManifest(join(firstRoot, "package.json"), {
              name: "first",
              version: "1.0.0",
              lucent: { dependencies: { second: "^2.0.0" } },
            }),
            write(join(firstRoot, "index.js"), "exports.first = true;"),
            writeManifest(join(secondRoot, "package.json"), {
              name: "second",
              version: "2.3.0",
              lucent: { dependencies: { first: "*" } },
            }),
            write(join(secondRoot, "index.js"), "exports.second = true;"),
          ]),
        );

        const discovery = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));

        expect(discovery.packages.get("first")?.dependencyStatus).toEqual({
          status: "ready",
        });
        expect(discovery.packages.get("second")?.dependencyStatus).toEqual({
          status: "ready",
        });
      }),
  );

  it.effect(
    "blocks missing, mismatched, unversioned, and transitive dependencies",
    () =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
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
        yield* Effect.promise(() =>
          Promise.all(
            manifests.flatMap((manifest) => {
              const root = join(workspace.packagesDir, manifest.name);
              return [
                writeManifest(join(root, "package.json"), manifest),
                write(join(root, "index.js"), "exports.value = true;"),
              ];
            }),
          ),
        );

        const discovery = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));

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
      }),
  );

  it.effect(
    "derives verified and modified integrity from the app-owned baseline",
    () =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
        const packageRoot = join(workspace.packagesDir, "tools-folder");
        yield* Effect.promise(() =>
          Promise.all([
            write(
              join(packageRoot, "package.json"),
              '{"name":"@author/tools"}',
            ),
            write(join(packageRoot, "index.js"), "exports.value = 1"),
          ]),
        );
        const managed: ManagedScriptPackage = {
          directory: "tools-folder",
          files: yield* hashDirectory(packageRoot),
          installedAt: epoch,
          name: "@author/tools",
          source: {
            kind: "repository",
            repositoryUrl: "https://github.com/example/tools",
            resolvedCommit: "abc123",
          },
        };

        const verified = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          managedPackages: [managed],
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));
        expect(verified.catalog.packages[0]).toMatchObject({
          integrity: "verified",
        });

        yield* Effect.promise(() =>
          write(join(packageRoot, "index.js"), "exports.value = 2"),
        );
        const modified = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          managedPackages: [managed],
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));
        expect(modified.catalog.packages[0]).toMatchObject({
          integrity: "modified",
        });
      }),
  );

  it.effect(
    "rejects a managed folder that declares a different package name",
    () =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(() => makeWorkspace());
        const packageRoot = join(workspace.packagesDir, "tracked-folder");
        yield* Effect.promise(() =>
          write(join(packageRoot, "package.json"), '{"name":"other-name"}'),
        );
        const managed: ManagedScriptPackage = {
          directory: "tracked-folder",
          files: yield* hashDirectory(packageRoot),
          installedAt: epoch,
          name: "expected-name",
          source: {
            kind: "repository",
            repositoryUrl: "https://github.com/example/package",
            resolvedCommit: "abc123",
          },
        };

        const discovery = yield* discoverScriptCatalog({
          currentVersion: "1.2.3",
          managedPackages: [managed],
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }).pipe(Effect.map((report) => report.discovery));

        expect(discovery.catalog.packages[0]).toMatchObject({
          status: "invalid",
          name: "other-name",
          diagnostic: expect.stringContaining(
            'installed package name is "expected-name"',
          ),
        });
        expect(discovery.packages.size).toBe(0);
      }),
  );
});

const makeCatalogHarness = (
  onScan: Effect.Effect<void> = Effect.void,
  managedPackages: readonly ManagedScriptPackage[] = [],
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = nodeFileSystemLayer,
) =>
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
      exit: () => Effect.void,
      getAppMetrics: Effect.succeed([]),
      getVersion: Effect.succeed("1.0.0"),
      on: () => Effect.void,
      quit: Effect.void,
      relaunch: Effect.void,
      whenReady: Effect.void,
    });
    const state = ScriptPackageState.of({
      get: () => Effect.sync((): ManagedScriptPackage | undefined => undefined),
      getAll: Effect.sync(() => {
        scanCount += 1;
        return managedPackages;
      }).pipe(Effect.tap(() => onScan)),
      remove: () => Effect.void,
      save: () => Effect.void,
    });
    const testLayer = scriptPackageCatalogLayer.pipe(
      Layer.provide(fileSystemLayer),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(DesktopEnvironment, environment),
          Layer.succeed(ElectronApp, app),
          Layer.succeed(ScriptPackageState, state),
        ),
      ),
    );

    const catalog = yield* ScriptPackageCatalog.pipe(Effect.provide(testLayer));
    return { catalog, workspace, scanCount: () => scanCount };
  });

layer(nodeFileSystemLayer)("ScriptPackageCatalog", (it) => {
  it.effect(
    "canonicalizes loose file and directory casing only when the filesystem resolves it",
    () =>
      Effect.gen(function* () {
        const { catalog, workspace } = yield* makeCatalogHarness();
        yield* Effect.promise(() =>
          write(
            join(workspace.scriptsDir, "Lib", "util.js"),
            "exports.value = 1;",
          ),
        );
        const caseInsensitive = yield* Effect.promise(() =>
          fs.stat(join(workspace.scriptsDir, "Lib", "Util.js")).then(
            () => true,
            (cause: NodeJS.ErrnoException) => {
              if (cause.code === "ENOENT") return false;
              throw cause;
            },
          ),
        );

        for (const path of ["Lib/util.js", "Lib/Util.js", "lib/UTIL.js"]) {
          const expected =
            path === "Lib/util.js" || caseInsensitive
              ? { kind: "loose", path: "Lib/util.js" }
              : undefined;
          expect(
            yield* catalog.referenceForPath(join(workspace.scriptsDir, path)),
          ).toEqual(expected);
          expect(
            yield* catalog.resolveReference({ kind: "loose", path }),
          ).toEqual(
            expected === undefined
              ? undefined
              : {
                  name: "util.js",
                  path: join(workspace.scriptsDir, "Lib", "util.js"),
                  reference: { kind: "loose", path: "Lib/util.js" },
                  relativePath: "Lib/util.js",
                },
          );
        }
      }),
  );

  it.effect(
    "shares one loose module id across differently cased imports when the filesystem resolves them",
    () =>
      Effect.gen(function* () {
        const { catalog, workspace } = yield* makeCatalogHarness();
        yield* Effect.promise(() =>
          Promise.all([
            write(
              join(workspace.scriptsDir, "entry.js"),
              'require("./a"); require("./b");',
            ),
            write(join(workspace.scriptsDir, "a.js"), 'require("./util");'),
            write(join(workspace.scriptsDir, "b.js"), 'require("./Util");'),
            write(join(workspace.scriptsDir, "util.js"), "exports.value = 1;"),
          ]),
        );
        const caseInsensitive = yield* Effect.promise(() =>
          fs.stat(join(workspace.scriptsDir, "Util.js")).then(
            () => true,
            (cause: NodeJS.ErrnoException) => {
              if (cause.code === "ENOENT") return false;
              throw cause;
            },
          ),
        );
        const registry = yield* makeScriptSourceRegistry().pipe(
          Effect.provideService(ScriptPackageCatalog, catalog),
          Effect.provideService(
            FileSystem.FileSystem,
            Context.get(
              yield* Layer.build(nodeFileSystemLayer),
              FileSystem.FileSystem,
            ),
          ),
        );
        const read = registry.readReference({
          kind: "loose",
          path: "entry.js",
        });
        if (!caseInsensitive) {
          const error = yield* read.pipe(Effect.flip);
          expect(error.message).toBe(
            'b.js can\'t import "./Util". The relative module was not found.',
          );
          return;
        }

        const file = yield* read;
        expect(file.snapshot?.modules.map((module) => module.id)).toEqual([
          "loose:a.js",
          "loose:b.js",
          "loose:entry.js",
          "loose:util.js",
        ]);
        expect(
          file.snapshot?.modules.find((module) => module.id === "loose:a.js")
            ?.imports,
        ).toEqual({ "./util": { kind: "module", moduleId: "loose:util.js" } });
        expect(
          file.snapshot?.modules.find((module) => module.id === "loose:b.js")
            ?.imports,
        ).toEqual({ "./Util": { kind: "module", moduleId: "loose:util.js" } });
      }),
  );

  it.effect(
    "rejects loose symlinks, escapes, and noncanonical path syntax",
    () =>
      Effect.gen(function* () {
        const { catalog, workspace } = yield* makeCatalogHarness();
        yield* Effect.promise(async () => {
          await write(join(workspace.root, "outside.js"), "exports.value = 1;");
          await write(
            join(workspace.scriptsDir, "Lib", "util.js"),
            "exports.value = 1;",
          );
          await fs.symlink(
            join(workspace.root, "outside.js"),
            join(workspace.scriptsDir, "linked.js"),
          );
          await fs.symlink(
            join(workspace.scriptsDir, "Lib"),
            join(workspace.scriptsDir, "alias"),
            "junction",
          );
        });

        for (const path of [
          "linked.js",
          "alias/util.js",
          "../outside.js",
          "./first.js",
          "Lib/../first.js",
        ]) {
          expect(
            yield* catalog.resolveReference({ kind: "loose", path }),
          ).toBeUndefined();
        }
      }),
  );

  it.effect("recreates missing catalog folders recursively", () =>
    Effect.gen(function* () {
      const { catalog, workspace } = yield* makeCatalogHarness();
      yield* Effect.promise(() => fs.rm(workspace.root, { recursive: true }));
      expect(yield* catalog.refresh).toMatchObject({
        packages: [],
        scriptCount: 0,
      });
      expect(
        (yield* Effect.promise(() => fs.readdir(workspace.root))).sort(),
      ).toEqual(["packages", "scripts"]);
      expect(
        (yield* Effect.promise(() =>
          fs.stat(workspace.scriptsDir),
        )).isDirectory(),
      ).toBe(true);
      expect(
        (yield* Effect.promise(() =>
          fs.stat(workspace.packagesDir),
        )).isDirectory(),
      ).toBe(true);
    }),
  );

  it.effect("preserves scan errors and their native mkdir cause", () =>
    Effect.gen(function* () {
      const native = Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
      const failingFileSystem = FileSystem.layerNoop({
        makeDirectory: () =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "makeDirectory",
              cause: native,
            }),
          ),
      });
      const { catalog } = yield* makeCatalogHarness(
        Effect.void,
        [],
        failingFileSystem,
      );
      const error = yield* catalog.refresh.pipe(Effect.flip);
      expect(error._tag).toBe("ScriptPackageCatalogError");
      expect(error.operation).toBe("scan");
      expect(error.message).toBe("Failed to scan the script package catalog.");
      expect(error.cause).toBe(native);
    }),
  );

  it.effect("logs unexpected package inspection failures once per scan", () =>
    Effect.gen(function* () {
      const { catalog, workspace } = yield* makeCatalogHarness();
      yield* Effect.promise(() =>
        Promise.all(
          ["first", "second"].flatMap((name) => [
            writeManifest(join(workspace.packagesDir, name, "package.json"), {
              name,
            }),
            write(
              join(workspace.packagesDir, name, "index.js"),
              "exports.value = 1",
            ),
          ]),
        ),
      );
      const lstat = fs.lstat;
      vi.spyOn(fs, "lstat").mockImplementation(
        (...args: Parameters<typeof fs.lstat>) =>
          String(args[0]).endsWith("package.json")
            ? Promise.reject(
                Object.assign(
                  new Error(
                    String(args[0]).includes("second") ? "EIO" : "EACCES",
                  ),
                  { code: "EACCES" },
                ),
              )
            : lstat(...args),
      );
      const logs: DesktopLogRecord[] = [];
      const result = yield* catalog.refresh.pipe(
        Effect.withLogger(
          Logger.make((options) => logs.push(desktopLogRecord(options))),
        ),
      );
      expect(result.packages).toEqual([
        {
          status: "invalid",
          diagnostic: "EACCES",
          path: join(workspace.packagesDir, "first"),
        },
        {
          status: "invalid",
          diagnostic: "EIO",
          path: join(workspace.packagesDir, "second"),
        },
      ]);
      expect(
        logs.map(({ level, component, message, repeatKey, data }) => ({
          level,
          component,
          message,
          repeatKey,
          data,
        })),
      ).toEqual([
        {
          level: "warn",
          component: "script-packages",
          message: "Failed to inspect script package files",
          repeatKey: "first,second",
          data: { packageNames: ["first", "second"] },
        },
      ]);
      expect(
        logs[0]?.error?.map(({ name, message }) => ({ name, message })),
      ).toEqual([
        { name: "Error", message: "EACCES" },
        { name: "Error", message: "EIO" },
      ]);
    }),
  );

  it.effect(
    "logs failed integrity reads while retaining the modified result",
    () =>
      Effect.gen(function* () {
        const managedPackages: ManagedScriptPackage[] = [];
        const { catalog, workspace } = yield* makeCatalogHarness(
          Effect.void,
          managedPackages,
        );
        const rootPath = join(workspace.packagesDir, "tools");
        yield* Effect.promise(() =>
          Promise.all([
            write(join(rootPath, "package.json"), '{"name":"tools"}'),
            write(join(rootPath, "index.js"), "exports.value = 1"),
          ]),
        );
        managedPackages.push({
          directory: "tools",
          files: yield* hashDirectory(rootPath),
          installedAt: "2026-10-17T00:00:00.000Z",
          name: "tools",
          source: {
            kind: "repository",
            repositoryUrl: "https://github.com/example/tools",
            resolvedCommit: "abc123",
          },
        });
        const stat = fs.stat;
        vi.spyOn(fs, "stat").mockImplementation(
          (...args: Parameters<typeof fs.stat>) =>
            String(args[0]) === join(rootPath, "index.js")
              ? Promise.reject(Object.assign(new Error("EIO"), { code: "EIO" }))
              : stat(...args),
        );
        const logs: DesktopLogRecord[] = [];
        const result = yield* catalog.refresh.pipe(
          Effect.withLogger(
            Logger.make((options) => logs.push(desktopLogRecord(options))),
          ),
        );
        expect(result.packages[0]).toMatchObject({
          status: "valid",
          name: "tools",
          integrity: "modified",
        });
        expect(
          logs.map(({ level, component, message, repeatKey, data }) => ({
            level,
            component,
            message,
            repeatKey,
            data,
          })),
        ).toEqual([
          {
            level: "warn",
            component: "script-packages",
            message: "Failed to inspect script package files",
            repeatKey: "tools",
            data: { packageNames: ["tools"] },
          },
        ]);
        expect(
          logs[0]?.error?.map(({ name, message }) => ({ name, message })),
        ).toEqual([{ name: "Error", message: "EIO" }]);
      }),
  );

  it.effect(
    "keeps invalid manifests, missing manifests, and local modifications silent",
    () =>
      Effect.gen(function* () {
        const managedPackages: ManagedScriptPackage[] = [];
        const { catalog, workspace } = yield* makeCatalogHarness(
          Effect.void,
          managedPackages,
        );
        const rootPath = join(workspace.packagesDir, "tools");
        yield* Effect.promise(() =>
          Promise.all([
            write(join(rootPath, "package.json"), '{"name":"tools"}'),
            write(join(rootPath, "index.js"), "exports.value = 1"),
            write(
              join(workspace.packagesDir, "invalid", "package.json"),
              "private invalid contents",
            ),
            write(join(workspace.packagesDir, "missing", "index.js"), ""),
          ]),
        );
        managedPackages.push({
          directory: "tools",
          files: yield* hashDirectory(rootPath),
          installedAt: "2026-10-17T00:00:00.000Z",
          name: "tools",
          source: {
            kind: "repository",
            repositoryUrl: "https://github.com/example/tools",
            resolvedCommit: "abc123",
          },
        });
        yield* Effect.promise(() =>
          write(join(rootPath, "index.js"), "exports.value = 2"),
        );
        const logs: DesktopLogRecord[] = [];
        const result = yield* catalog.refresh.pipe(
          Effect.withLogger(
            Logger.make((options) => logs.push(desktopLogRecord(options))),
          ),
        );
        expect(result.packages.map((entry) => entry.status)).toEqual([
          "invalid",
          "invalid",
          "valid",
        ]);
        expect(result.packages[2]).toMatchObject({
          name: "tools",
          integrity: "modified",
        });
        expect(logs).toEqual([]);
      }),
  );

  it.effect.each([8, 16, 32] as const)(
    "publishes revisions in order with a %i-operation scheduling budget",
    (maxOps) =>
      Effect.gen(function* () {
        const scanStarted = yield* Deferred.make<void>();
        const { catalog, workspace } = yield* makeCatalogHarness(
          Deferred.succeed(scanStarted, undefined).pipe(Effect.asVoid),
        );
        yield* Effect.promise(() =>
          write(
            join(workspace.packagesDir, "tools", "package.json"),
            '{"name":"tools"}',
          ),
        );
        const revisions: string[] = [];
        yield* catalog.onChanged((change) => {
          revisions.push(change.revision);
        });

        const refreshing = yield* catalog.refresh.pipe(
          Effect.provideService(References.MaxOpsBeforeYield, maxOps),
          Effect.forkScoped,
        );
        yield* Deferred.await(scanStarted);
        const removing = yield* catalog
          .removePackage("tools")
          .pipe(Effect.forkScoped);
        const refreshed = yield* Fiber.join(refreshing);
        const removed = yield* Fiber.join(removing);

        expect(refreshed.packages.map((entry) => entry.name)).toEqual([
          "tools",
        ]);
        expect(removed.packages).toEqual([]);
        expect(revisions).toEqual([refreshed.revision, removed.revision]);
        expect((yield* catalog.getOverview).revision).toBe(revisions.at(-1));
      }),
  );

  it.effect(
    "coalesces the first scan and rescans only on explicit refresh",
    () =>
      Effect.gen(function* () {
        const { catalog, workspace, scanCount } = yield* makeCatalogHarness();
        expect(scanCount()).toBe(0);
        const [first, concurrent] = yield* Effect.all(
          [catalog.getOverview, catalog.getOverview],
          { concurrency: "unbounded" },
        );
        expect(first.scriptCount).toBe(1);
        expect(concurrent.revision).toBe(first.revision);
        expect(scanCount()).toBe(1);

        yield* Effect.promise(() =>
          write(join(workspace.scriptsDir, "second.js"), ""),
        );
        expect((yield* catalog.getOverview).scriptCount).toBe(1);
        expect(scanCount()).toBe(1);

        const refreshed = yield* catalog.refresh;
        expect(refreshed.scriptCount).toBe(2);
        expect(scanCount()).toBe(2);
      }),
  );

  it.effect("filters catalog pages from the requested revision", () =>
    Effect.gen(function* () {
      const { catalog, workspace } = yield* makeCatalogHarness();
      yield* Effect.promise(() =>
        write(join(workspace.scriptsDir, "second.js"), ""),
      );
      const refreshed = yield* catalog.getOverview;
      const page = yield* catalog.getPage({
        limit: 128,
        offset: 0,
        query: "second",
        revision: refreshed.revision,
      });
      expect(page.total).toBe(1);
      expect(page.entries[0]?.relativePath).toBe("second.js");
    }),
  );

  it.effect("keeps the last catalog after a failed refresh and can retry", () =>
    Effect.gen(function* () {
      const { catalog, workspace } = yield* makeCatalogHarness();
      const initial = yield* catalog.refresh;
      const revisions: string[] = [];
      yield* catalog.onChanged((change) => {
        revisions.push(change.revision);
      });
      yield* Effect.promise(async () => {
        await fs.rm(workspace.packagesDir, { recursive: true });
        await fs.writeFile(workspace.packagesDir, "not a directory");
      });
      const failure = yield* catalog.refresh.pipe(Effect.flip);
      expect(failure.operation).toBe("scan");
      expect(revisions).toEqual([]);
      expect(yield* catalog.getOverview).toEqual(initial);
      yield* Effect.promise(async () => {
        await fs.unlink(workspace.packagesDir);
        await write(join(workspace.scriptsDir, "second.js"), "");
      });
      const retried = yield* catalog.refresh;
      expect(retried.scriptCount).toBe(2);
      expect(revisions).toEqual([retried.revision]);
    }),
  );

  it.effect(
    "rescans instead of hiding another folder with the replacement name",
    () =>
      Effect.gen(function* () {
        const { catalog, workspace, scanCount } = yield* makeCatalogHarness();
        const duplicatePath = join(workspace.packagesDir, "other-tools");
        yield* Effect.promise(() =>
          write(join(duplicatePath, "package.json"), '{"name":"tools"}'),
        );
        expect((yield* catalog.getOverview).packages).toMatchObject([
          { status: "valid", name: "tools", path: duplicatePath },
        ]);
        const rootPath = join(workspace.packagesDir, "tools");
        yield* Effect.promise(() =>
          write(join(rootPath, "package.json"), '{"name":"tools"}'),
        );
        const inspected = yield* inspectScriptPackageDirectory(rootPath);
        const replaced = yield* catalog.replacePackage({
          inspected,
          integrity: "modified",
          managed: {
            directory: "tools",
            name: "tools",
            files: {},
            installedAt: epoch,
            source: {
              kind: "repository",
              repositoryUrl: "https://github.com/example/tools",
              resolvedCommit: "abc123",
            },
          },
          rootPath,
          sourceRoot: rootPath,
        });
        expect(replaced.packages).toEqual(
          [duplicatePath, rootPath].map((path) => ({
            status: "invalid",
            name: "tools",
            path,
            diagnostic:
              'More than one package folder declares the name "tools".',
          })),
        );
        expect((yield* catalog.getDiscovery).packages.size).toBe(0);
        expect(scanCount()).toBe(2);
      }),
  );
  it.effect("replaces and removes a package without a full rescan", () =>
    Effect.gen(function* () {
      const { catalog, workspace, scanCount } = yield* makeCatalogHarness();
      yield* catalog.getOverview;
      const sourceRoot = join(workspace.root, "staged-tools");
      const rootPath = join(workspace.packagesDir, "tools");
      yield* Effect.promise(() =>
        Promise.all([
          writeManifest(join(sourceRoot, "package.json"), { name: "tools" }),
          write(join(sourceRoot, "scripts", "tool.js"), ""),
        ]),
      );
      const inspected = yield* inspectScriptPackageDirectory(sourceRoot);
      yield* Effect.promise(() => fs.rename(sourceRoot, rootPath));
      const managed: ManagedScriptPackage = {
        directory: "tools",
        files: yield* hashDirectory(rootPath),
        installedAt: epoch,
        name: "tools",
        source: {
          kind: "repository",
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
      expect(replaced.scriptCount).toBe(2);
      expect(scanCount()).toBe(1);
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
      expect(removed.scriptCount).toBe(1);
      expect(scanCount()).toBe(1);
    }),
  );
});

it.effect("returns the committed catalog during a refresh scan", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let block = false;
    const { catalog, workspace } = yield* makeCatalogHarness(
      Effect.suspend(() =>
        block
          ? Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
            )
          : Effect.void,
      ),
    );
    yield* catalog.getOverview;
    yield* Effect.promise(() =>
      write(join(workspace.scriptsDir, "second.js"), ""),
    );
    block = true;
    const scanning = yield* catalog.refresh.pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const reading = yield* catalog.getOverview.pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    const duringScan = reading.pollUnsafe();
    yield* Deferred.succeed(release, undefined);
    expect((yield* Fiber.join(reading)).scriptCount).toBe(1);
    expect((yield* Fiber.join(scanning)).scriptCount).toBe(2);
    expect(duringScan).toMatchObject({
      _tag: "Success",
      value: { scriptCount: 1 },
    });
    expect((yield* catalog.getOverview).scriptCount).toBe(2);
  }),
);

it.effect(
  "publishes every refresh even when the catalog content is unchanged",
  () =>
    Effect.gen(function* () {
      const { catalog, workspace } = yield* makeCatalogHarness();
      let changes = 0;
      yield* catalog.onChanged(() => {
        changes += 1;
      });
      expect((yield* catalog.refresh).scriptCount).toBe(1);
      expect((yield* catalog.refresh).scriptCount).toBe(1);
      expect(changes).toBe(2);
      yield* Effect.promise(() =>
        write(join(workspace.scriptsDir, "second.js"), ""),
      );
      expect((yield* catalog.refresh).scriptCount).toBe(2);
      expect(changes).toBe(3);
      expect((yield* catalog.refresh).scriptCount).toBe(2);
      expect((yield* catalog.getOverview).scriptCount).toBe(2);
      expect(changes).toBe(4);
    }),
);
