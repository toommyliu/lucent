import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, layer } from "@effect/vitest";
import { vi } from "vitest";

import {
  listRegularFilePaths,
  readPackageFile,
} from "./ScriptPackageFileSystem";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

layer(NodeFileSystem.layer)("readPackageFile", (it) => {
  it.effect("retries changed files up to three attempts", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "lucent-stable-file-")),
      );
      directories.push(root);
      const path = join(root, "value.js");
      yield* Effect.promise(() => fs.writeFile(path, "initial"));
      const stat = fs.stat;
      let checks = 0;
      vi.spyOn(fs, "stat").mockImplementation(async (...args) => {
        checks += 1;
        if (checks === 2) await fs.writeFile(path, "second");
        if (checks === 4) await fs.writeFile(path, "third");
        return stat(...args);
      });

      expect((yield* readPackageFile(path, 16)).toString("utf8")).toBe("third");
      expect(checks).toBe(6);
    }),
  );

  it.effect("fails after three changed reads without a fourth attempt", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "lucent-stable-file-")),
      );
      directories.push(root);
      const path = join(root, "value.js");
      yield* Effect.promise(() => fs.writeFile(path, "initial"));
      const stat = fs.stat;
      let checks = 0;
      vi.spyOn(fs, "stat").mockImplementation(async (...args) => {
        checks += 1;
        if (checks % 2 === 0) await fs.appendFile(path, "!");
        return stat(...args);
      });

      expect(
        (yield* readPackageFile(path, 16).pipe(Effect.flip)).message,
      ).toContain(`File changed while it was being read: ${path}.`);
      expect(yield* Effect.promise(() => fs.readFile(path, "utf8"))).toBe(
        "initial!!!",
      );
      expect(checks).toBe(6);
    }),
  );

  it.effect(
    "does not retry a file that exceeds the bound while being read",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() =>
          fs.mkdtemp(join(tmpdir(), "lucent-stable-file-")),
        );
        directories.push(root);
        const path = join(root, "value.js");
        yield* Effect.promise(() => fs.writeFile(path, "1234"));
        const stat = fs.stat;
        let checks = 0;
        vi.spyOn(fs, "stat").mockImplementation(async (...args) => {
          checks += 1;
          const info = await stat(...args);
          await fs.appendFile(path, "56789");
          return info;
        });

        expect(
          (yield* readPackageFile(path, 8).pipe(Effect.flip)).message,
        ).toContain(`File exceeds the 8 bytes limit: ${path}.`);
        expect(yield* Effect.promise(() => fs.readFile(path, "utf8"))).toBe(
          "123456789",
        );
        expect(checks).toBe(1);
      }),
  );

  it.effect("rejects directories before reading", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "lucent-stable-file-")),
      );
      directories.push(root);
      expect(
        (yield* readPackageFile(root, 16).pipe(Effect.flip)).message,
      ).toContain(`Expected a regular file: ${root}.`);
    }),
  );

  it.effect("does not retry when the file disappears after reading", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "lucent-stable-file-")),
      );
      directories.push(root);
      const path = join(root, "value.js");
      yield* Effect.promise(() => fs.writeFile(path, "initial"));
      const stat = fs.stat;
      let checks = 0;
      vi.spyOn(fs, "stat").mockImplementation(async (...args) => {
        checks += 1;
        if (checks === 2) {
          throw Object.assign(new Error("File disappeared"), {
            code: "ENOENT",
          });
        }
        return stat(...args);
      });

      expect(
        (yield* readPackageFile(path, 16).pipe(Effect.flip)).message,
      ).toContain("File disappeared");
      expect(checks).toBe(2);
    }),
  );
});

layer(NodeFileSystem.layer)("listRegularFilePaths", (it) => {
  it.effect("applies file limits only when the caller requests one", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        fs.mkdtemp(join(tmpdir(), "lucent-file-inventory-")),
      );
      directories.push(root);
      yield* Effect.promise(() =>
        Promise.all(
          ["one.js", "two.js", "three.js"].map((name) =>
            fs.writeFile(join(root, name), "", "utf8"),
          ),
        ),
      );

      const paths = yield* listRegularFilePaths(root);
      expect(paths).toHaveLength(3);
      expect(paths[0]).toEqual({
        absolutePath: join(root, "one.js"),
        relativePath: "one.js",
      });
      expect(
        (yield* listRegularFilePaths(root, { maxFiles: 2 }).pipe(Effect.flip))
          .message,
      ).toContain("Directory contains more than 2 files");
    }),
  );
});
