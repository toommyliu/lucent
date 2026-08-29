import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "net";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { vi } from "vitest";
import { DesktopFileSystem, isAlreadyExists } from "./DesktopFileSystem";
import { layer } from "./DesktopFileSystemNode";

const roots: string[] = [];
// The adapter contract uses real native filesystem effects; this helper keeps
// each assertion concise while the production code remains fully effectful.
// eslint-disable-next-line lucent/no-manual-effect-runtime-in-tests
const run = <A>(effect: Effect.Effect<A, unknown, DesktopFileSystem>) =>
  // eslint-disable-next-line lucent/no-manual-effect-runtime-in-tests
  Effect.runPromise(effect.pipe(Effect.provide(layer)));
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe("DesktopFileSystemNode", () => {
  it("bounds reads and normalizes errors", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "lucent-fs-"));
    roots.push(root);
    const path = join(root, "file");
    await fs.writeFile(path, "abcd");
    await expect(
      run(
        Effect.gen(function* () {
          const files = yield* DesktopFileSystem;
          return yield* files.readTextFile(path, { maxBytes: 4 });
        }),
      ),
    ).resolves.toBe("abcd");
    await expect(
      run(
        Effect.gen(function* () {
          const files = yield* DesktopFileSystem;
          return yield* files.readTextFile(path, { maxBytes: 3 });
        }),
      ),
    ).rejects.toMatchObject({ reason: "TooLarge" });
    await expect(
      run(
        Effect.gen(function* () {
          const files = yield* DesktopFileSystem;
          return yield* files.readFile(join(root, "missing"), { maxBytes: 4 });
        }),
      ),
    ).rejects.toMatchObject({ reason: "NotFound" });
  });
  it("supports exclusive writes and scoped temporary directories", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "lucent-fs-"));
    roots.push(root);
    const path = join(root, "file");
    await fs.writeFile(path, "old");
    await expect(
      run(
        Effect.gen(function* () {
          const files = yield* DesktopFileSystem;
          return yield* files.writeFile(path, "new", { exclusive: true });
        }),
      ),
    ).rejects.toSatisfy((error) => isAlreadyExists(error));
    const temp = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* DesktopFileSystem;
          const path = yield* files.makeTempDirectoryScoped({
            directory: root,
          });
          expect((yield* files.stat(path)).type).toBe("directory");
          expect(path.startsWith(`${root}/`)).toBe(true);
          return path;
        }),
      ),
    );
    await expect(fs.stat(temp)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reports links, entries, metadata, and mutations without leaking Stats", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "lucent-fs-"));
    roots.push(root);
    await fs.mkdir(join(root, "directory"));
    await fs.writeFile(join(root, "file"), "value");
    await fs.symlink("file", join(root, "link"));
    let socketServer: ReturnType<typeof createServer> | undefined;
    if (process.platform !== "win32")
      await fs.symlink("directory", join(root, "directory-link"));
    if (process.platform !== "win32") {
      socketServer = createServer();
      await new Promise<void>((resolve, reject) => {
        socketServer
          ?.once("error", reject)
          .listen(join(root, "socket"), resolve);
      });
    }
    const files = await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) => service.readDirectory(root)),
      ),
    );
    await new Promise<void>(
      (resolve) => socketServer?.close(() => resolve()) ?? resolve(),
    );
    expect(files.find((entry) => entry.name === "file")).toMatchObject({
      type: "file",
    });
    expect(files.find((entry) => entry.name === "directory")).toMatchObject({
      type: "directory",
    });
    expect(files.find((entry) => entry.name === "link")).toMatchObject({
      type: "symbolic-link",
    });
    if (process.platform !== "win32")
      expect(files.find((entry) => entry.name === "socket")).toMatchObject({
        type: "other",
      });
    const followed = await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) => service.stat(join(root, "link"))),
      ),
    );
    const linked = await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) => service.lstat(join(root, "link"))),
      ),
    );
    const native = await fs.stat(join(root, "file"));
    expect(followed).toMatchObject({
      type: "file",
      size: native.size,
      mode: native.mode,
      device: native.dev,
      inode: native.ino,
      modifiedTimeMs: native.mtimeMs,
      changedTimeMs: native.ctimeMs,
      birthTimeMs: native.birthtimeMs,
    });
    expect(linked.type).toBe("symbolic-link");
    expect(linked).not.toBeInstanceOf(
      Object.getPrototypeOf(native).constructor,
    );
    const renamed = join(root, "renamed");
    await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) =>
          service.rename(join(root, "file"), renamed),
        ),
      ),
    );
    await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) => service.removeFile(renamed)),
      ),
    );
    await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) =>
          service.removeFile(renamed, { ignoreMissing: true }),
        ),
      ),
    );
  });
  it("removes nested links safely and applies modes", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "lucent-fs-"));
    roots.push(root);
    const target = join(root, "target");
    const nested = join(root, "nested");
    await fs.mkdir(nested);
    await fs.mkdir(target);
    await fs.writeFile(join(target, "keep"), "target");
    await fs.symlink(target, join(nested, "target-link"));
    const created = join(root, "mode");
    await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) =>
          service.writeFile(created, "x", { mode: 0o600 }),
        ),
      ),
    );
    if (process.platform !== "win32")
      expect((await fs.stat(created)).mode & 0o777).toBe(0o600);
    await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) =>
          service.removeDirectory(nested, { recursive: true }),
        ),
      ),
    );
    await expect(fs.stat(join(target, "keep"))).resolves.toBeTruthy();
    await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) =>
          service.removeDirectory(nested, {
            recursive: true,
            ignoreMissing: true,
          }),
        ),
      ),
    );
  });
  it("syncs files and reports directory sync support", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "lucent-fs-"));
    roots.push(root);
    const path = join(root, "file");
    await fs.writeFile(path, "x");
    await expect(
      run(
        Effect.service(DesktopFileSystem).pipe(
          Effect.flatMap((service) => service.syncFile(path)),
        ),
      ),
    ).resolves.toBeUndefined();
    const result = await run(
      Effect.service(DesktopFileSystem).pipe(
        Effect.flatMap((service) => service.syncDirectory(root)),
      ),
    );
    expect(result.status).toBe(
      process.platform === "win32" ? "unsupported" : "synced",
    );
  });
  // This test must control native Promise completion and inspect fibers directly.
  /* eslint-disable lucent/no-manual-effect-runtime-in-tests */
  it("does not report an interrupted mutation while native write is in flight", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "lucent-fs-"));
    roots.push(root);
    const started = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const original = fs.writeFile.bind(fs);
    const writeSpy = vi
      .spyOn(fs, "writeFile")
      .mockImplementation(async (...args) => {
        await Effect.runPromise(Deferred.succeed(started, undefined));
        await Effect.runPromise(Deferred.await(release));
        return original(...args);
      });
    try {
      const writeFiber = Effect.runFork(
        Effect.gen(function* () {
          const service = yield* DesktopFileSystem;
          return yield* service.writeFile(join(root, "gated"), "value");
        }).pipe(Effect.provide(layer)),
      );
      await Effect.runPromise(Deferred.await(started));
      const interruptFiber = Effect.runFork(Fiber.interrupt(writeFiber));
      await Effect.runPromise(Effect.promise(() => Promise.resolve()));
      expect(interruptFiber.pollUnsafe()).toBeUndefined();
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(interruptFiber));
      await expect(fs.readFile(join(root, "gated"), "utf8")).resolves.toBe(
        "value",
      );
    } finally {
      writeSpy.mockRestore();
    }
  });
  /* eslint-enable lucent/no-manual-effect-runtime-in-tests */
});
