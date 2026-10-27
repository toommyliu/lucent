import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { fileSystemLayer } from "../filesystem/FileSystemTesting";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, layer } from "@effect/vitest";
import { vi } from "vitest";

import { readScriptPackageManifest } from "./ScriptPackageInspection";
import { discoverScriptCatalog } from "./ScriptCatalogDiscovery";

const reads = { bytes: 0, largestChunk: 0 };
const countingFileSystem = fileSystemLayer((real) => ({
  stream: (path, options) =>
    real.stream(path, options).pipe(
      Stream.tap((chunk) =>
        Effect.sync(() => {
          reads.bytes += chunk.byteLength;
          reads.largestChunk = Math.max(reads.largestChunk, chunk.byteLength);
        }),
      ),
    ),
}));

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

layer(countingFileSystem)((it) => {
  it.effect("reads a manifest once when discovering an unmanaged package", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "lucent-manifest-")),
      );
      directories.push(root);
      const packagesDir = join(root, "packages");
      const packageRoot = join(packagesDir, "tools-folder");
      yield* Effect.promise(() => fs.mkdir(packageRoot, { recursive: true }));
      const source = '{"name":"tools","lucent":{"version":"^1.0.0"}}';
      yield* Effect.promise(() =>
        fs.writeFile(join(packageRoot, "package.json"), source),
      );
      yield* Effect.promise(() =>
        fs.writeFile(join(packageRoot, "index.js"), ""),
      );
      reads.bytes = 0;
      reads.largestChunk = 0;

      const discovery = yield* discoverScriptCatalog({
        currentVersion: "1.2.3",
        packagesDir,
        scriptsDir: join(root, "scripts"),
      }).pipe(Effect.map((report) => report.discovery));

      expect(discovery.catalog.packages).toEqual([
        {
          status: "valid",
          compatibility: {
            status: "compatible",
            currentVersion: "1.2.3",
            requiredVersion: "^1.0.0",
          },
          dependencyStatus: { status: "ready" },
          integrity: "unmanaged",
          name: "tools",
          path: packageRoot,
          update: { status: "unchecked" },
        },
      ]);
      expect(reads.bytes).toBe(Buffer.byteLength(source));
    }),
  );

  it.effect("bounds a manifest that grows after its no-follow size check", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "lucent-manifest-")),
      );
      directories.push(root);
      const path = join(root, "package.json");
      yield* Effect.promise(() => fs.writeFile(path, '{"name":"example"}'));
      expect(yield* readScriptPackageManifest(path)).toEqual({
        dependencies: {},
        main: "index.js",
        name: "example",
      });
      reads.bytes = 0;
      reads.largestChunk = 0;
      const lstat = fs.lstat;
      vi.spyOn(fs, "lstat").mockImplementationOnce(async (...args) => {
        const info = await lstat(...args);
        await fs.appendFile(path, " ".repeat(2 * 1024 * 1024));
        return info;
      });

      expect(
        (yield* readScriptPackageManifest(path).pipe(Effect.flip)).message,
      ).toContain("package.json exceeds the 1 MiB limit.");
      expect(reads.bytes).toBe(1_048_577);
      expect(reads.largestChunk).toBe(65_536);
    }),
  );
});
