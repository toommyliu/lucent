import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { expect, layer as testLayer } from "@effect/vitest";
import { afterEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeAtomicFile } from "./AtomicFile";
import {
  DesktopFileSystem,
  DesktopFileSystemError,
  type DesktopFileSystemReason,
} from "./DesktopFileSystem";
import { layer } from "./DesktopFileSystemNode";

const fixtureDirectories = new Set<string>();

const makeFixture = async (): Promise<string> => {
  const path = await fs.mkdtemp(join(tmpdir(), "lucent-atomic-file-"));
  fixtureDirectories.add(path);
  return path;
};

const makeWriteError = (
  path: string,
  reason: DesktopFileSystemReason,
): DesktopFileSystemError =>
  new DesktopFileSystemError({
    operation: "write",
    target: { _tag: "PathTarget", path },
    reason,
    cause: new Error(`Simulated ${reason} write failure.`),
  });

afterEach(async () => {
  await Promise.all(
    [...fixtureDirectories].map((path) =>
      fs.rm(path, { recursive: true, force: true }),
    ),
  );
  fixtureDirectories.clear();
});

testLayer(layer)("AtomicFile", (it) => {
  it.effect("publishes without cleaning the released temp path", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const path = join(root, "nested", "state.json");
      const fileSystem = yield* DesktopFileSystem;
      const guardedFileSystem = DesktopFileSystem.of({
        ...fileSystem,
        removeFile: () => Effect.die("successful publication ran cleanup"),
      });

      yield* makeAtomicFile(guardedFileSystem).write(path, "value");

      expect(yield* Effect.promise(() => fs.readFile(path, "utf8"))).toBe(
        "value",
      );
      expect(
        yield* Effect.promise(() => fs.readdir(join(root, "nested"))),
      ).toEqual(["state.json"]);
    }),
  );

  it.effect("cleans a partially written temp after write failure", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const destination = join(root, "state.json");
      const fileSystem = yield* DesktopFileSystem;
      const failingFileSystem = DesktopFileSystem.of({
        ...fileSystem,
        writeFile: (path, _data, options) =>
          fileSystem
            .writeFile(path, "partial", options)
            .pipe(
              Effect.flatMap(() =>
                Effect.fail(makeWriteError(path, "Unknown")),
              ),
            ),
      });

      yield* makeAtomicFile(failingFileSystem)
        .write(destination, "complete")
        .pipe(Effect.flip);

      expect(yield* Effect.promise(() => fs.readdir(root))).toEqual([]);
    }),
  );

  it.effect("does not delete a temp owned by an AlreadyExists collision", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const destination = join(root, "state.json");
      const fileSystem = yield* DesktopFileSystem;
      const collidingFileSystem = DesktopFileSystem.of({
        ...fileSystem,
        writeFile: (path) =>
          fileSystem
            .writeFile(path, "other-owner", { disposition: "create-new" })
            .pipe(
              Effect.flatMap(() =>
                Effect.fail(makeWriteError(path, "AlreadyExists")),
              ),
            ),
      });

      yield* makeAtomicFile(collidingFileSystem)
        .write(destination, "value")
        .pipe(Effect.flip);

      const entries = yield* Effect.promise(() => fs.readdir(root));
      expect(entries).toHaveLength(1);
      const tempName = entries[0];
      if (tempName === undefined) {
        return yield* Effect.die("expected a colliding temp file");
      }
      expect(tempName).toMatch(/\.tmp$/);
      expect(
        yield* Effect.promise(() => fs.readFile(join(root, tempName), "utf8")),
      ).toBe("other-owner");
    }),
  );

  it.effect("cleans its temp when publication fails", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const destination = join(root, "occupied");
      yield* Effect.promise(() => fs.mkdir(destination));
      const atomicFile = makeAtomicFile(yield* DesktopFileSystem);

      yield* atomicFile.write(destination, "value").pipe(Effect.flip);

      expect(yield* Effect.promise(() => fs.readdir(root))).toEqual([
        "occupied",
      ]);
    }),
  );

  it.effect("cleans its temp when interrupted before publication", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const destination = join(root, "state.json");
      const fileSystem = yield* DesktopFileSystem;
      let renameStarted!: () => void;
      const waitForRename = new Promise<void>((resolve) => {
        renameStarted = resolve;
      });
      const interruptedFileSystem = DesktopFileSystem.of({
        ...fileSystem,
        rename: () =>
          Effect.sync(renameStarted).pipe(Effect.flatMap(() => Effect.never)),
      });
      const fiber = yield* Effect.forkChild(
        makeAtomicFile(interruptedFileSystem).write(destination, "value"),
      );
      yield* Effect.promise(() => waitForRename);
      yield* Fiber.interrupt(fiber);

      expect(yield* Effect.promise(() => fs.readdir(root))).toEqual([]);
    }),
  );
});
