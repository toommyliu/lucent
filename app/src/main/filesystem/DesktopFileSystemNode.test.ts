import { constants as bufferConstants } from "buffer";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { expect, layer as testLayer } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { DesktopFileSystem } from "./DesktopFileSystem";
import { layer } from "./DesktopFileSystemNode";

const fixtureDirectories = new Set<string>();

const decodeText = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("utf8");

const makeFixture = async (): Promise<string> => {
  const path = await fs.mkdtemp(join(tmpdir(), "lucent-filesystem-"));
  fixtureDirectories.add(path);
  return path;
};

const makeGate = () => {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [...fixtureDirectories].map((path) =>
      fs.rm(path, { recursive: true, force: true }),
    ),
  );
  fixtureDirectories.clear();
});

testLayer(layer)("DesktopFileSystemNode", (it) => {
  it.effect(
    "observes effectively missing paths without hiding other errors",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(makeFixture);
        const filePath = join(root, "file.txt");
        const danglingPath = join(root, "dangling");
        yield* Effect.promise(() => fs.writeFile(filePath, "value"));
        yield* Effect.promise(() =>
          fs.symlink(join(root, "missing"), danglingPath),
        );

        const fileSystem = yield* DesktopFileSystem;
        expect(yield* fileSystem.exists(filePath)).toBe(true);
        expect(yield* fileSystem.exists(join(root, "missing"))).toBe(false);
        expect(yield* fileSystem.exists(danglingPath)).toBe(false);
        expect(yield* fileSystem.exists(join(filePath, "child"))).toBe(false);

        const notDirectory = yield* fileSystem
          .stat(join(filePath, "child"))
          .pipe(Effect.flip);
        expect(notDirectory.reason).toBe("NotDirectory");

        vi.spyOn(fs, "stat").mockRejectedValueOnce(
          Object.assign(new Error("denied"), { code: "EACCES" }),
        );
        const denied = yield* fileSystem
          .exists(join(root, "denied"))
          .pipe(Effect.flip);
        expect(denied.reason).toBe("PermissionDenied");
      }),
  );

  it.effect("reads in bounded chunks and detects exactly one excess byte", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const exactPath = join(root, "exact.txt");
      const oversizedPath = join(root, "oversized.txt");
      yield* Effect.promise(() =>
        Promise.all([
          fs.writeFile(exactPath, "12345678"),
          fs.writeFile(oversizedPath, "123456789"),
        ]),
      );

      const fileSystem = yield* DesktopFileSystem;
      expect(
        decodeText(yield* fileSystem.readFile(exactPath, { maxBytes: 8 })),
      ).toBe("12345678");

      const smallReadWithLargeBound = yield* fileSystem.readFile(exactPath, {
        maxBytes: bufferConstants.MAX_LENGTH,
      });
      expect(smallReadWithLargeBound.byteLength).toBe(8);
      expect(smallReadWithLargeBound.buffer.byteLength).toBe(8);

      const tooLarge = yield* fileSystem
        .readFile(oversizedPath, { maxBytes: 8 })
        .pipe(Effect.flip);
      expect(tooLarge.reason).toBe("TooLarge");

      const invalid = yield* fileSystem
        .readFile(exactPath, { maxBytes: bufferConstants.MAX_LENGTH + 1 })
        .pipe(Effect.flip);
      expect(invalid.reason).toBe("InvalidInput");
    }),
  );

  it.effect("distinguishes link metadata from followed metadata", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const filePath = join(root, "file.txt");
      const directoryPath = join(root, "directory");
      const linkPath = join(root, "link");
      yield* Effect.promise(() => fs.writeFile(filePath, "metadata"));
      yield* Effect.promise(() => fs.mkdir(directoryPath));
      yield* Effect.promise(() => fs.symlink(filePath, linkPath));
      const nativeInfo = yield* Effect.promise(() => fs.stat(filePath));

      const fileSystem = yield* DesktopFileSystem;
      expect((yield* fileSystem.stat(linkPath)).kind).toBe("file");
      expect((yield* fileSystem.lstat(linkPath)).kind).toBe("symbolic-link");
      expect(yield* fileSystem.realPath(linkPath)).toBe(
        yield* Effect.promise(() => fs.realpath(filePath)),
      );

      const entries = yield* fileSystem.readDirectory(root);
      expect(
        Object.fromEntries(
          entries.map((entry) => [entry.name, entry.kindHint]),
        ),
      ).toMatchObject({
        directory: "directory",
        "file.txt": "file",
        link: "symbolic-link",
      });

      expect(yield* fileSystem.stat(filePath)).toEqual({
        kind: "file",
        sizeBytes: nativeInfo.size,
        mode: nativeInfo.mode,
        device: nativeInfo.dev,
        inode: nativeInfo.ino,
        modifiedTimeMs: nativeInfo.mtimeMs,
        changedTimeMs: nativeInfo.ctimeMs,
        birthTimeMs: nativeInfo.birthtimeMs,
      });
    }),
  );

  it.effect("honors explicit write and copy dispositions", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const source = join(root, "source.txt");
      const copy = join(root, "copy.txt");
      const fileSystem = yield* DesktopFileSystem;

      yield* fileSystem.writeFile(source, "one", {
        disposition: "create-new",
      });
      const collision = yield* fileSystem
        .writeFile(source, "lost", { disposition: "create-new" })
        .pipe(Effect.flip);
      expect(collision.reason).toBe("AlreadyExists");

      yield* fileSystem.writeFile(source, "two", {
        disposition: "truncate-or-create",
      });
      yield* fileSystem.writeFile(source, "+three", {
        disposition: "append-or-create",
      });
      expect(
        decodeText(yield* fileSystem.readFile(source, { maxBytes: 32 })),
      ).toBe("two+three");

      yield* fileSystem.copyFile(source, copy, { disposition: "create-new" });
      const copyCollision = yield* fileSystem
        .copyFile(source, copy, { disposition: "create-new" })
        .pipe(Effect.flip);
      expect(copyCollision.reason).toBe("AlreadyExists");
      expect(copyCollision.target).toEqual({
        _tag: "PathPairTarget",
        source,
        destination: copy,
      });

      yield* fileSystem.writeFile(source, "replacement", {
        disposition: "truncate-or-create",
      });
      yield* fileSystem.copyFile(source, copy, {
        disposition: "overwrite-or-create",
      });
      expect(
        decodeText(yield* fileSystem.readFile(copy, { maxBytes: 32 })),
      ).toBe("replacement");
    }),
  );

  it.effect("removes trees without following nested or root symlinks", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const target = join(root, "target");
      const tree = join(root, "tree");
      const rootLink = join(root, "root-link");
      yield* Effect.promise(() => fs.mkdir(target));
      yield* Effect.promise(() =>
        fs.writeFile(join(target, "keep.txt"), "keep"),
      );
      yield* Effect.promise(() =>
        fs.mkdir(join(tree, "nested"), { recursive: true }),
      );
      yield* Effect.promise(() =>
        fs.symlink(
          target,
          join(tree, "nested", "target-link"),
          process.platform === "win32" ? "junction" : "dir",
        ),
      );
      yield* Effect.promise(() =>
        fs.symlink(
          target,
          rootLink,
          process.platform === "win32" ? "junction" : "dir",
        ),
      );

      const fileSystem = yield* DesktopFileSystem;
      yield* fileSystem.removeDirectory(tree, {
        recursive: true,
        ifMissing: "fail",
      });
      expect(yield* fileSystem.exists(join(target, "keep.txt"))).toBe(true);

      const rootLinkError = yield* fileSystem
        .removeDirectory(rootLink, { recursive: true, ifMissing: "fail" })
        .pipe(Effect.flip);
      expect(rootLinkError.reason).toBe("NotDirectory");
      expect(yield* fileSystem.exists(join(target, "keep.txt"))).toBe(true);
    }),
  );

  it.effect("tolerates a child disappearing during recursive removal", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const tree = join(root, "tree");
      const racingPath = join(tree, "a.txt");
      yield* Effect.promise(() => fs.mkdir(tree));
      yield* Effect.promise(() =>
        Promise.all([
          fs.writeFile(racingPath, "race"),
          fs.writeFile(join(tree, "b.txt"), "remove"),
        ]),
      );

      const originalLstat = fs.lstat.bind(fs);
      let raced = false;
      vi.spyOn(fs, "lstat").mockImplementation(async (path) => {
        if (path === racingPath && !raced) {
          raced = true;
          await fs.unlink(racingPath);
        }
        return originalLstat(path);
      });

      const fileSystem = yield* DesktopFileSystem;
      yield* fileSystem.removeDirectory(tree, {
        recursive: true,
        ifMissing: "fail",
      });
      expect(raced).toBe(true);
      expect(yield* fileSystem.exists(tree)).toBe(false);
    }),
  );

  it.effect("waits for an in-flight native mutation before interrupting", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const filePath = join(root, "interrupted.txt");
      const originalWriteFile = fs.writeFile.bind(fs);
      const nativeStarted = makeGate();
      const nativeRelease = makeGate();
      vi.spyOn(fs, "writeFile").mockImplementation(async () => {
        nativeStarted.open();
        await nativeRelease.wait;
        await originalWriteFile(filePath, "completed");
      });

      const fileSystem = yield* DesktopFileSystem;
      const mutationFiber = yield* Effect.forkChild(
        fileSystem.writeFile(filePath, "completed", {
          disposition: "truncate-or-create",
        }),
      );
      yield* Effect.promise(() => nativeStarted.wait);

      let interruptionFinished = false;
      const interruptionFiber = yield* Effect.forkChild(
        Fiber.interrupt(mutationFiber).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              interruptionFinished = true;
            }),
          ),
        ),
      );
      yield* Effect.promise(
        () => new Promise<void>((resolve) => setImmediate(resolve)),
      );
      expect(interruptionFinished).toBe(false);

      nativeRelease.open();
      yield* Fiber.join(interruptionFiber);
      expect(interruptionFinished).toBe(true);
      expect(
        decodeText(yield* fileSystem.readFile(filePath, { maxBytes: 32 })),
      ).toBe("completed");
    }),
  );
});
