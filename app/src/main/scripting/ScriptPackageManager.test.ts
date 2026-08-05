import { promises as fs } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { create as createTar } from "tar";

import type {
  ScriptCatalog,
  ScriptCatalogOverview,
  ScriptPackageIntegrity,
} from "@lucent/core/scriptPackages";
import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../app/DesktopEnvironment";
import {
  GitHubScriptPackageClient,
  type GitHubCommitResolution,
  type GitHubScriptPackageClientShape,
} from "./GitHubScriptPackageClient";
import {
  ScriptPackageCatalog,
  type DiscoveredScriptCatalog,
} from "./ScriptPackageCatalog";
import {
  extractScriptPackageArchive,
  layer as scriptPackageManagerLayer,
  ScriptPackageManager,
  validateScriptPackageArchive,
} from "./ScriptPackageManager";
import {
  ScriptPackageState,
  type ManagedScriptPackage,
} from "./ScriptPackageState";

const directories: string[] = [];
const INSTALLED_COMMIT = "1".repeat(40);
const REMOTE_COMMIT = "2".repeat(40);
const PACKAGE_NAME = "example";

const makeDirectory = async (): Promise<string> => {
  const path = await fs.mkdtemp(join(tmpdir(), "lucent-package-archive-"));
  directories.push(path);
  return path;
};

const write = async (path: string, source: string): Promise<void> => {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, source, "utf8");
};

const makeManagerHarness = (options: {
  readonly archivePath?: string;
  readonly integrity?: ScriptPackageIntegrity;
  readonly managed: ManagedScriptPackage;
  readonly resolution: GitHubCommitResolution;
  readonly workspaceDir?: string;
}) => {
  let managed = options.managed;
  let downloadCount = 0;
  const requests: Parameters<
    GitHubScriptPackageClientShape["resolveCommit"]
  >[0][] = [];

  const currentCatalog = (): ScriptCatalog => ({
    packages: [
      {
        status: "valid",
        compatibility: {
          status: "compatible",
          currentVersion: "1.0.0",
          requiredVersion: "*",
        },
        integrity: options.integrity ?? "verified",
        name: PACKAGE_NAME,
        path: join(
          options.workspaceDir ?? "/tmp/lucent",
          "packages",
          PACKAGE_NAME,
        ),
        source: managed.source,
        update: managed.update ?? { status: "unchecked" },
      },
    ],
    revision: "test-catalog",
    scripts: [],
  });
  const currentDiscovery = (): DiscoveredScriptCatalog => ({
    catalog: currentCatalog(),
    paths: new Map(),
    packages: new Map(),
    scripts: new Map(),
  });
  const currentOverview = (): ScriptCatalogOverview => ({
    packages: currentCatalog().packages,
    revision: currentCatalog().revision,
    scriptCount: 0,
  });
  const catalog = ScriptPackageCatalog.of({
    getDiscovery: Effect.sync(currentDiscovery),
    getOverview: Effect.sync(currentOverview),
    getPage: () =>
      Effect.succeed({
        entries: [],
        offset: 0,
        revision: currentCatalog().revision,
        total: 0,
      }),
    onChanged: () => Effect.succeed(() => undefined),
    referenceForPath: () => Effect.succeed(undefined),
    refresh: Effect.sync(currentOverview),
    removePackage: () => Effect.sync(currentOverview),
    replacePackage: () => Effect.sync(currentOverview),
    resolveReference: () => Effect.succeed(undefined),
    updateManagedPackage: () => Effect.sync(currentOverview),
  });
  const client = GitHubScriptPackageClient.of({
    downloadArchive: ({ targetPath }) =>
      Effect.promise(async () => {
        downloadCount += 1;
        if (options.archivePath !== undefined) {
          await fs.copyFile(options.archivePath, targetPath);
        }
      }),
    resolveCommit: (input) =>
      Effect.sync(() => {
        requests.push(input);
        return options.resolution;
      }),
  });
  const state = ScriptPackageState.of({
    get: (name) =>
      Effect.sync(() => (name === managed.name ? managed : undefined)),
    getAll: Effect.sync(() => [managed]),
    remove: () => Effect.void,
    save: (value) =>
      Effect.sync(() => {
        managed = value;
      }),
  });
  const environment = makeDesktopEnvironment({
    appDataDir: "/tmp/lucent-package-manager-data",
    assetsDir: "/tmp/lucent-package-manager-assets",
    isDev: true,
    platform: "darwin",
    workspaceDir: options.workspaceDir ?? "/tmp/lucent",
  });
  const layer = scriptPackageManagerLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DesktopEnvironment, environment),
        Layer.succeed(GitHubScriptPackageClient, client),
        Layer.succeed(ScriptPackageCatalog, catalog),
        Layer.succeed(ScriptPackageState, state),
      ),
    ),
  );

  return {
    downloadCount: () => downloadCount,
    layer,
    managed: () => managed,
    requests,
  };
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe("script package archives", () => {
  it("validates and extracts a normal GitHub-style root", async () => {
    const root = await makeDirectory();
    const source = join(root, "source", "repository-commit");
    await Promise.all([
      write(join(source, "package.json"), '{"name":"tools"}'),
      write(join(source, "scripts", "farm.js"), "module.exports = 1"),
    ]);
    const archive = join(root, "package.tgz");
    await createTar({ cwd: join(root, "source"), file: archive, gzip: true }, [
      "repository-commit",
    ]);

    await expect(validateScriptPackageArchive(archive)).resolves.toEqual({
      root: "repository-commit",
    });
    const extracted = join(root, "extracted");
    await extractScriptPackageArchive(archive, extracted);
    await expect(
      fs.readFile(join(extracted, "package.json"), "utf8"),
    ).resolves.toContain('"tools"');
  });

  it("rejects symbolic links before extraction", async () => {
    const root = await makeDirectory();
    const sourceRoot = join(root, "source");
    const source = join(sourceRoot, "repository-commit");
    await write(join(source, "package.json"), '{"name":"tools"}');
    await fs.symlink("package.json", join(source, "linked.json"));
    const archive = join(root, "package.tgz");
    await createTar({ cwd: sourceRoot, file: archive, gzip: true }, [
      "repository-commit",
    ]);

    await expect(validateScriptPackageArchive(archive)).rejects.toThrow(
      "unsupported type SymbolicLink",
    );
  });
});

describe("script package updates", () => {
  it.effect(
    "does not download when the remote commit is already installed",
    () =>
      Effect.gen(function* () {
        const harness = makeManagerHarness({
          managed: {
            etag: "stale-etag-without-a-commit",
            files: {},
            installedAt: "2026-07-27T00:00:00.000Z",
            name: PACKAGE_NAME,
            source: {
              repositoryUrl: "https://github.com/example/package",
              resolvedCommit: INSTALLED_COMMIT,
            },
          },
          resolution: {
            status: "modified",
            commit: INSTALLED_COMMIT,
            etag: "current-etag",
          },
        });
        const manager = yield* ScriptPackageManager.pipe(
          Effect.provide(harness.layer),
        );

        const result = yield* manager.update({ packageName: PACKAGE_NAME });

        expect(result.status).toBe("unchanged");
        expect(harness.downloadCount()).toBe(0);
        expect(harness.requests[0]?.etag).toBeUndefined();
        expect(harness.managed()).toMatchObject({
          etag: "current-etag",
          remoteCommit: INSTALLED_COMMIT,
          update: { status: "current" },
        });
      }),
  );

  it.effect(
    "reinstalls the current commit when restoring local modifications",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(makeDirectory);
        const workspaceDir = join(root, "workspace");
        const sourceRoot = join(root, "source");
        const source = join(sourceRoot, "repository-commit");
        const destination = join(workspaceDir, "packages", PACKAGE_NAME);
        yield* Effect.promise(() =>
          Promise.all([
            write(
              join(source, "package.json"),
              JSON.stringify({ name: PACKAGE_NAME }),
            ),
            write(join(source, "index.js"), "module.exports = 'remote';"),
            write(
              join(destination, "package.json"),
              JSON.stringify({ name: PACKAGE_NAME }),
            ),
            write(
              join(destination, "index.js"),
              "module.exports = 'locally modified';",
            ),
          ]),
        );
        const archivePath = join(root, "package.tgz");
        yield* Effect.promise(() =>
          createTar({ cwd: sourceRoot, file: archivePath, gzip: true }, [
            "repository-commit",
          ]),
        );
        const harness = makeManagerHarness({
          archivePath,
          integrity: "modified",
          managed: {
            etag: "current-etag",
            files: {},
            installedAt: "2026-07-27T00:00:00.000Z",
            name: PACKAGE_NAME,
            remoteCommit: INSTALLED_COMMIT,
            source: {
              repositoryUrl: "https://github.com/example/package",
              resolvedCommit: INSTALLED_COMMIT,
            },
          },
          resolution: {
            status: "modified",
            commit: INSTALLED_COMMIT,
            etag: "current-etag",
          },
          workspaceDir,
        });
        const manager = yield* ScriptPackageManager.pipe(
          Effect.provide(harness.layer),
        );

        const confirmation = yield* manager.update({
          packageName: PACKAGE_NAME,
        });
        expect(confirmation).toMatchObject({
          status: "confirmation-required",
          reason: "local-modifications",
        });

        const result = yield* manager.update({
          packageName: PACKAGE_NAME,
          replaceModified: true,
        });

        expect(result.status).toBe("completed");
        expect(harness.downloadCount()).toBe(1);
        expect(
          yield* Effect.promise(() =>
            fs.readFile(join(destination, "index.js"), "utf8"),
          ),
        ).toBe("module.exports = 'remote';");
      }),
  );

  it.effect("keeps an observed update available after a 304 response", () =>
    Effect.gen(function* () {
      const harness = makeManagerHarness({
        managed: {
          etag: "remote-etag",
          files: {},
          installedAt: "2026-07-27T00:00:00.000Z",
          name: PACKAGE_NAME,
          remoteCommit: REMOTE_COMMIT,
          source: {
            repositoryUrl: "https://github.com/example/package",
            resolvedCommit: INSTALLED_COMMIT,
          },
          update: {
            status: "available",
            checkedAt: "2026-08-01T00:00:00.000Z",
            commit: REMOTE_COMMIT,
          },
        },
        resolution: { status: "not-modified" },
      });
      const manager = yield* ScriptPackageManager.pipe(
        Effect.provide(harness.layer),
      );

      const catalog = yield* manager.checkUpdate({ packageName: PACKAGE_NAME });

      expect(harness.requests[0]?.etag).toBe("remote-etag");
      expect(harness.managed()).toMatchObject({
        etag: "remote-etag",
        remoteCommit: REMOTE_COMMIT,
        update: { status: "available", commit: REMOTE_COMMIT },
      });
      expect(catalog.packages[0]).toMatchObject({
        update: { status: "available", commit: REMOTE_COMMIT },
      });
    }),
  );
});
