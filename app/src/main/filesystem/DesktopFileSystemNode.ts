import { constants, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  DesktopFileSystem,
  DesktopFileSystemError,
  type DesktopFileInfo,
  type DesktopDirectoryEntry,
} from "./DesktopFileSystem";

const reasonFor = (cause: unknown) => {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;
  if (code === "ENOENT" || code === "ENOTDIR") return "NotFound" as const;
  if (code === "EEXIST" || code === "ENOTEMPTY")
    return "AlreadyExists" as const;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS")
    return "PermissionDenied" as const;
  if (code === "EBUSY" || code === "EMFILE" || code === "ENFILE")
    return "Busy" as const;
  if (code === "EXDEV") return "CrossDevice" as const;
  if (code === "ENOSPC" || code === "EDQUOT") return "NoSpace" as const;
  if (code === "EISDIR" || code === "ELOOP" || code === "EINVAL")
    return "BadResource" as const;
  return "Unknown" as const;
};
const fail = (
  operation: DesktopFileSystemError["operation"],
  path: string,
  cause: unknown,
  destination?: string,
) =>
  new DesktopFileSystemError({
    operation,
    path,
    reason: reasonFor(cause),
    cause,
    ...(destination === undefined ? {} : { destination }),
  });
const mutation = <A>(
  operation: DesktopFileSystemError["operation"],
  path: string,
  thunk: () => Promise<A>,
  destination?: string,
) =>
  // Native mutations must settle before interruption so cleanup cannot race them.
  Effect.tryPromise({
    try: thunk,
    catch: (cause) => fail(operation, path, cause, destination),
  }).pipe(Effect.uninterruptible);
const info = (stats: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mode: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
}): DesktopFileInfo => ({
  type: stats.isFile()
    ? "file"
    : stats.isDirectory()
      ? "directory"
      : stats.isSymbolicLink()
        ? "symbolic-link"
        : "other",
  size: stats.size,
  mode: stats.mode,
  device: stats.dev,
  inode: stats.ino,
  modifiedTimeMs: stats.mtimeMs,
  changedTimeMs: stats.ctimeMs,
  birthTimeMs: stats.birthtimeMs,
});
const entry = (item: {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): DesktopDirectoryEntry => ({
  name: item.name,
  type: item.isFile()
    ? "file"
    : item.isDirectory()
      ? "directory"
      : item.isSymbolicLink()
        ? "symbolic-link"
        : "other",
});
const removeRecursively = async (path: string): Promise<void> => {
  for (const item of await fs.readdir(path, { withFileTypes: true })) {
    const child = join(path, item.name);
    if (item.isDirectory() && !item.isSymbolicLink())
      await removeRecursively(child);
    else await fs.unlink(child);
  }
  await fs.rmdir(path);
};

const makeDirectory = (
  path: string,
  options: Readonly<{ recursive?: boolean; mode?: number }> = {},
) =>
  mutation("make-directory", path, () =>
    fs.mkdir(
      path,
      options.mode === undefined
        ? { recursive: options.recursive ?? false }
        : { recursive: options.recursive ?? false, mode: options.mode },
    ),
  );
const makeTempDirectory = (
  options: Readonly<{ directory?: string; prefix?: string }> = {},
) =>
  mutation("make-temp", options.directory ?? tmpdir(), () =>
    fs.mkdtemp(
      join(options.directory ?? tmpdir(), options.prefix ?? "lucent-"),
    ),
  );
const readFile = (path: string, options: Readonly<{ maxBytes: number }>) =>
  Effect.tryPromise({
    try: async () => {
      const handle = await fs.open(path, "r");
      try {
        const chunks: Buffer[] = [];
        let total = 0;
        const chunkSize = Math.min(64 * 1024, options.maxBytes + 1);
        // The fixed chunk caps retained data at the limit plus one chunk.
        while (total <= options.maxBytes) {
          const buffer = Buffer.alloc(chunkSize);
          const result = await handle.read(buffer, 0, chunkSize, total);
          if (result.bytesRead === 0) break;
          chunks.push(buffer.subarray(0, result.bytesRead));
          total += result.bytesRead;
        }
        if (total > options.maxBytes)
          throw Object.assign(new Error("File exceeds maximum size"), {
            code: "ETOOLARGE",
          });
        return Buffer.concat(chunks, total);
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      new DesktopFileSystemError({
        operation: "read",
        path,
        reason:
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "ETOOLARGE"
            ? "TooLarge"
            : reasonFor(cause),
        cause,
      }),
  });
const nodeLayer = Layer.succeed(
  DesktopFileSystem,
  DesktopFileSystem.of({
    makeDirectory,
    makeTempDirectory,
    makeTempDirectoryScoped: (options = {}) =>
      Effect.acquireRelease(makeTempDirectory(options), (path) =>
        mutation("remove", path, () => removeRecursively(path)).pipe(
          Effect.ignore,
        ),
      ),
    readFile,
    readTextFile: (path, options) =>
      readFile(path, options).pipe(
        Effect.map((data) => Buffer.from(data).toString("utf8")),
      ),
    readDirectory: (path) =>
      Effect.tryPromise({
        try: async () =>
          (await fs.readdir(path, { withFileTypes: true })).map(entry),
        catch: (cause) => fail("list", path, cause),
      }),
    stat: (path) =>
      Effect.tryPromise({
        try: async () => info(await fs.stat(path)),
        catch: (cause) => fail("stat", path, cause),
      }),
    lstat: (path) =>
      Effect.tryPromise({
        try: async () => info(await fs.lstat(path)),
        catch: (cause) => fail("stat", path, cause),
      }),
    realPath: (path) =>
      Effect.tryPromise({
        try: () => fs.realpath(path),
        catch: (cause) => fail("real-path", path, cause),
      }),
    writeFile: (path, data, options = {}) =>
      mutation("write", path, () =>
        fs.writeFile(
          path,
          data,
          options.mode === undefined
            ? { flag: options.exclusive ? "wx" : "w" }
            : { flag: options.exclusive ? "wx" : "w", mode: options.mode },
        ),
      ),
    copyFile: (source, destination, options = {}) =>
      mutation(
        "copy",
        source,
        () =>
          fs.copyFile(
            source,
            destination,
            options.exclusive ? constants.COPYFILE_EXCL : 0,
          ),
        destination,
      ),
    rename: (source, destination) =>
      mutation(
        "rename",
        source,
        () => fs.rename(source, destination),
        destination,
      ),
    removeFile: (path, options = {}) =>
      mutation("remove", path, () => fs.unlink(path)).pipe(
        Effect.catchTag("DesktopFileSystemError", (error) =>
          options.ignoreMissing && error.reason === "NotFound"
            ? Effect.void
            : Effect.fail(error),
        ),
      ),
    removeDirectory: (path, options = {}) =>
      mutation("remove", path, () =>
        options.recursive ? removeRecursively(path) : fs.rmdir(path),
      ).pipe(
        Effect.catchTag("DesktopFileSystemError", (error) =>
          options.ignoreMissing && error.reason === "NotFound"
            ? Effect.void
            : Effect.fail(error),
        ),
      ),
    syncFile: (path) =>
      mutation("sync", path, async () => {
        const handle = await fs.open(path, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }),
    syncDirectory: (path) =>
      process.platform === "win32"
        ? Effect.succeed({ status: "unsupported" as const })
        : mutation("sync", path, async () => {
            const handle = await fs.open(path, "r");
            try {
              await handle.sync();
            } finally {
              await handle.close();
            }
          }).pipe(Effect.as({ status: "synced" as const })),
  }),
);
export const layer = nodeLayer;
