import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layer as desktopFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ScriptPackageState, layer as stateLayer } from "./ScriptPackageState";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.clear();
});

const loadState = (appDataDir: string) =>
  ScriptPackageState.pipe(
    Effect.provide(
      stateLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              DesktopEnvironment,
              DesktopEnvironment.of({
                appDataDir,
                assetsDir: join(appDataDir, "assets"),
                isDev: true,
                platform: "darwin",
                workspaceDir: join(appDataDir, "workspace"),
              }),
            ),
            desktopFileSystemLayer,
          ),
        ),
      ),
    ),
  );

const shared = { installedAt: "2026-10-01T00:00:00.000Z", files: {} };

describe("ScriptPackageState", () => {
  it.effect("loads and rewrites a version 1 state file", () =>
    Effect.gen(function* () {
      const appDataDir = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "lucent-package-state-")),
      );
      tempDirs.add(appDataDir);
      const statePath = join(appDataDir, "script-packages.json");
      yield* Effect.promise(() =>
        writeFile(
          statePath,
          JSON.stringify({
            version: 1,
            packages: [
              {
                ...shared,
                name: "bundled",
                directory: "bundled",
                source: {
                  kind: "directory",
                  repositoryUrl: "https://github.com/example/lucent",
                  resolvedTree: "tree-1",
                  subdirectory: "script-packages/bundled",
                },
              },
              {
                ...shared,
                name: "directory",
                directory: "directory",
                etag: "directory-etag",
                remoteRevision: { kind: "tree", sha: "tree-2" },
                source: {
                  kind: "directory",
                  repositoryUrl: "https://github.com/example/packages",
                  resolvedCommit: "commit-2",
                  resolvedTree: "tree-2",
                  subdirectory: "packages/directory",
                },
                update: {
                  status: "current",
                  checkedAt: "2026-10-02T00:00:00.000Z",
                },
              },
              {
                ...shared,
                name: "repository",
                directory: "repository",
                etag: "repository-etag",
                remoteRevision: { kind: "commit", sha: "commit-3" },
                source: {
                  kind: "repository",
                  repositoryUrl: "https://github.com/example/repository",
                  resolvedCommit: "commit-3",
                },
              },
            ],
          }),
        ),
      );

      const state = yield* loadState(appDataDir);
      const packages = yield* state.getAll;
      expect(packages).toEqual([
        {
          ...shared,
          name: "bundled",
          directory: "bundled",
          source: {
            kind: "bundled",
            repositoryUrl: "https://github.com/example/lucent",
            resolvedTree: "tree-1",
            subdirectory: "script-packages/bundled",
          },
          update: { status: "unchecked" },
        },
        {
          ...shared,
          name: "directory",
          directory: "directory",
          source: {
            kind: "directory",
            repositoryUrl: "https://github.com/example/packages",
            resolvedCommit: "commit-2",
            resolvedTree: "tree-2",
            subdirectory: "packages/directory",
          },
          update: { status: "current", checkedAt: "2026-10-02T00:00:00.000Z" },
        },
        {
          ...shared,
          name: "repository",
          directory: "repository",
          source: {
            kind: "repository",
            repositoryUrl: "https://github.com/example/repository",
            resolvedCommit: "commit-3",
          },
          commitLookup: { etag: "repository-etag", commit: "commit-3" },
          update: { status: "unchecked" },
        },
      ]);

      yield* state.remove("directory");
      const saved = JSON.parse(
        yield* Effect.promise(() => readFile(statePath, "utf8")),
      );
      expect(saved).toEqual({
        version: 2,
        packages: packages.filter((entry) => entry.name !== "directory"),
      });
      expect(yield* (yield* loadState(appDataDir)).getAll).toEqual(
        saved.packages,
      );
    }).pipe(Effect.provide(desktopFileSystemLayer)),
  );
});
