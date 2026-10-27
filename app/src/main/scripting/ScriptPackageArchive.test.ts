import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, expect, layer } from "@effect/vitest";
import { create as createTar } from "tar";

import {
  extractScriptPackageArchive,
  validateScriptPackageArchive,
} from "./ScriptPackageArchive";

const directories: string[] = [];
const PACKAGE_NAME = "example";
const PACKAGE_SUBDIRECTORY = "packages/example";
const PACKAGE_MANIFEST = JSON.stringify({ name: PACKAGE_NAME });

const makeDirectory = async (): Promise<string> => {
  const path = await fs.mkdtemp(join(tmpdir(), "lucent-package-archive-"));
  directories.push(path);
  return path;
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

layer(NodeFileSystem.layer)("script package archives", (it) => {
  it.effect("validates and extracts a normal GitHub-style root", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeDirectory());
      const source = join(root, "source", "repository-commit");
      yield* Effect.promise(() =>
        Promise.all([
          write(join(source, "package.json"), '{"name":"tools"}'),
          write(join(source, "scripts", "farm.js"), "module.exports = 1"),
        ]),
      );
      const archive = join(root, "package.tgz");
      yield* Effect.promise(() =>
        createTar({ cwd: join(root, "source"), file: archive, gzip: true }, [
          "repository-commit",
        ]),
      );

      expect(yield* validateScriptPackageArchive(archive)).toEqual({
        root: "repository-commit",
      });
      const extracted = join(root, "extracted");
      yield* extractScriptPackageArchive(archive, extracted);
      yield* Effect.promise(() =>
        expect(
          fs.readFile(join(extracted, "package.json"), "utf8"),
        ).resolves.toContain('"tools"'),
      );
    }),
  );

  it.effect("extracts only the selected package directory", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeDirectory());
      const sourceRoot = join(root, "source");
      const repository = join(sourceRoot, "repository-commit");
      yield* Effect.promise(() =>
        Promise.all([
          write(join(repository, "README.md"), "repository"),
          write(
            join(repository, PACKAGE_SUBDIRECTORY, "package.json"),
            PACKAGE_MANIFEST,
          ),
          write(
            join(repository, PACKAGE_SUBDIRECTORY, "index.js"),
            "module.exports = 'selected';",
          ),
          write(join(repository, "packages", "other", "private.txt"), "other"),
        ]),
      );
      const archive = join(root, "package.tgz");
      yield* Effect.promise(() =>
        createTar({ cwd: sourceRoot, file: archive, gzip: true }, [
          "repository-commit",
        ]),
      );

      expect(
        yield* validateScriptPackageArchive(archive, {
          subdirectory: PACKAGE_SUBDIRECTORY,
        }),
      ).toEqual({ root: "repository-commit" });
      const extracted = join(root, "extracted");
      yield* extractScriptPackageArchive(
        archive,
        extracted,
        PACKAGE_SUBDIRECTORY,
      );

      yield* Effect.promise(() =>
        expect(fs.readFile(join(extracted, "index.js"), "utf8")).resolves.toBe(
          "module.exports = 'selected';",
        ),
      );
      yield* Effect.promise(() =>
        expect(fs.access(join(extracted, "README.md"))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      );
      yield* Effect.promise(() =>
        expect(fs.access(join(extracted, "other"))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      );
      expect(
        (yield* validateScriptPackageArchive(archive, {
          subdirectory: "packages/missing",
        }).pipe(Effect.flip)).message,
      ).toContain('package directory "packages/missing"');
    }),
  );

  it.effect(
    "rejects unsafe entries outside the selected package directory",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => makeDirectory());
        const sourceRoot = join(root, "source");
        const repository = join(sourceRoot, "repository-commit");
        yield* Effect.promise(() =>
          write(
            join(repository, PACKAGE_SUBDIRECTORY, "package.json"),
            PACKAGE_MANIFEST,
          ),
        );
        yield* Effect.promise(() =>
          write(join(repository, "packages", "other", "target.txt"), "other"),
        );
        yield* Effect.promise(() =>
          fs.symlink(
            "target.txt",
            join(repository, "packages", "other", "linked.txt"),
          ),
        );
        const archive = join(root, "package.tgz");
        yield* Effect.promise(() =>
          createTar({ cwd: sourceRoot, file: archive, gzip: true }, [
            "repository-commit",
          ]),
        );

        expect(
          (yield* extractScriptPackageArchive(
            archive,
            join(root, "extracted"),
            PACKAGE_SUBDIRECTORY,
          ).pipe(Effect.flip)).message,
        ).toContain("unsupported type SymbolicLink");
      }),
  );

  it.effect("rejects symbolic links before extraction", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeDirectory());
      const sourceRoot = join(root, "source");
      const source = join(sourceRoot, "repository-commit");
      yield* Effect.promise(() =>
        write(join(source, "package.json"), '{"name":"tools"}'),
      );
      yield* Effect.promise(() =>
        fs.symlink("package.json", join(source, "linked.json")),
      );
      const archive = join(root, "package.tgz");
      yield* Effect.promise(() =>
        createTar({ cwd: sourceRoot, file: archive, gzip: true }, [
          "repository-commit",
        ]),
      );

      expect(
        (yield* validateScriptPackageArchive(archive).pipe(Effect.flip))
          .message,
      ).toContain("unsupported type SymbolicLink");
    }),
  );
});
