import { constants as bufferConstants } from "buffer";
import { constants, promises as fs, type Dirent, type Stats } from "fs";
import { tmpdir } from "os";
import { join, sep } from "path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  DesktopFileSystem,
  DesktopFileSystemError,
  type DesktopDirectoryEntry,
  type DesktopFileInfo,
  type DesktopFileKind,
  type DesktopFileSystemOperation,
  type DesktopFileSystemReason,
  type DesktopFileSystemTarget,
  type MissingPathBehavior,
  type WriteFileDisposition,
} from "./DesktopFileSystem";

const READ_CHUNK_BYTES = 64 * 1024;

class InvalidReadLimitError extends Error {}
class FileTooLargeError extends Error {}
class ExpectedDirectoryError extends Error {}

const errnoCode = (cause: unknown): unknown =>
  cause instanceof Error && "code" in cause ? cause.code : undefined;

const reasonFromCause = (cause: unknown): DesktopFileSystemReason => {
  if (cause instanceof InvalidReadLimitError) return "InvalidInput";
  if (cause instanceof FileTooLargeError) return "TooLarge";
  if (cause instanceof ExpectedDirectoryError) return "NotDirectory";

  switch (errnoCode(cause)) {
    case "ENOENT":
      return "NotFound";
    case "ENOTDIR":
      return "NotDirectory";
    case "EEXIST":
      return "AlreadyExists";
    case "ENOTEMPTY":
      return "DirectoryNotEmpty";
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "PermissionDenied";
    case "EBUSY":
    case "EMFILE":
    case "ENFILE":
      return "Busy";
    case "EXDEV":
      return "CrossDevice";
    case "ENOSPC":
    case "EDQUOT":
      return "NoSpace";
    case "EFBIG":
      return "TooLarge";
    case "EISDIR":
      return "IsDirectory";
    case "ELOOP":
    case "ENAMETOOLONG":
      return "BadResource";
    case "EINVAL":
      return "InvalidInput";
    default:
      return "Unknown";
  }
};

const isEffectivelyMissing = (error: DesktopFileSystemError): boolean =>
  error.reason === "NotFound" || error.reason === "NotDirectory";

const pathTarget = (path: string): DesktopFileSystemTarget => ({
  _tag: "PathTarget",
  path,
});

const pathPairTarget = (
  source: string,
  destination: string,
): DesktopFileSystemTarget => ({
  _tag: "PathPairTarget",
  source,
  destination,
});

const makeError = (
  operation: DesktopFileSystemOperation,
  target: DesktopFileSystemTarget,
  cause: unknown,
): DesktopFileSystemError =>
  new DesktopFileSystemError({
    operation,
    target,
    reason: reasonFromCause(cause),
    cause,
  });

const fromPromise = <Value>(
  operation: DesktopFileSystemOperation,
  target: DesktopFileSystemTarget,
  evaluate: () => PromiseLike<Value>,
): Effect.Effect<Value, DesktopFileSystemError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => makeError(operation, target, cause),
  });

// Native filesystem promises cannot be canceled. A mutation stays
// uninterruptible until the operating-system call has settled.
const fromMutationPromise = <Value>(
  operation: DesktopFileSystemOperation,
  target: DesktopFileSystemTarget,
  evaluate: () => PromiseLike<Value>,
): Effect.Effect<Value, DesktopFileSystemError> =>
  fromPromise(operation, target, evaluate).pipe(Effect.uninterruptible);

const fileKind = (value: Stats | Dirent): DesktopFileKind => {
  if (value.isFile()) return "file";
  if (value.isDirectory()) return "directory";
  if (value.isSymbolicLink()) return "symbolic-link";
  return "other";
};

const fileInfo = (value: Stats): DesktopFileInfo => ({
  kind: fileKind(value),
  sizeBytes: value.size,
  mode: value.mode,
  device: value.dev,
  inode: value.ino,
  modifiedTimeMs: value.mtimeMs,
  changedTimeMs: value.ctimeMs,
  birthTimeMs: value.birthtimeMs,
});

const readBounded = async (
  path: string,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > bufferConstants.MAX_LENGTH
  ) {
    throw new InvalidReadLimitError(`Invalid byte limit: ${maxBytes}`);
  }

  const handle = await fs.open(path, "r");
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes <= maxBytes) {
      const bytesWanted = Math.min(READ_CHUNK_BYTES, maxBytes + 1 - totalBytes);
      const chunk = Buffer.allocUnsafe(bytesWanted);
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }

  if (totalBytes > maxBytes) {
    throw new FileTooLargeError(`File exceeds ${maxBytes} bytes.`);
  }
  const contents = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    contents.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return contents;
};

const writeFlags = {
  "create-new": "wx",
  "truncate-or-create": "w",
  "append-or-create": "a",
} satisfies Record<WriteFileDisposition, "wx" | "w" | "a">;

const ignoreMissing = <Value>(
  effect: Effect.Effect<Value, DesktopFileSystemError>,
  behavior: MissingPathBehavior,
): Effect.Effect<Value | void, DesktopFileSystemError> =>
  effect.pipe(
    Effect.catch((error) =>
      behavior === "ignore" && isEffectivelyMissing(error)
        ? Effect.void
        : Effect.fail(error),
    ),
  );

const removeDirectoryTree = Effect.fn("DesktopFileSystem.removeDirectoryTree")(
  function* (
    path: string,
    isRoot: boolean,
    missingBehavior: MissingPathBehavior,
  ): Effect.fn.Return<void, DesktopFileSystemError> {
    const info = yield* ignoreMissing(
      fromPromise("remove-directory", pathTarget(path), () => fs.lstat(path)),
      missingBehavior,
    );
    if (info === undefined) return;

    if (!info.isDirectory()) {
      if (isRoot) {
        return yield* makeError(
          "remove-directory",
          pathTarget(path),
          new ExpectedDirectoryError(`Expected a directory at ${path}.`),
        );
      }
      yield* ignoreMissing(
        fromMutationPromise("remove-directory", pathTarget(path), () =>
          fs.unlink(path),
        ),
        "ignore",
      );
      return;
    }

    const entries = yield* ignoreMissing(
      fromPromise("remove-directory", pathTarget(path), () =>
        fs.readdir(path, { withFileTypes: true }),
      ),
      isRoot ? missingBehavior : "ignore",
    );
    if (entries === undefined) return;
    for (const entry of entries) {
      yield* removeDirectoryTree(join(path, entry.name), false, "ignore");
    }
    yield* ignoreMissing(
      fromMutationPromise("remove-directory", pathTarget(path), () =>
        fs.rmdir(path),
      ),
      missingBehavior,
    );
  },
);

const makeTempDirectory: DesktopFileSystem["Service"]["makeTempDirectory"] = (
  options = {},
) => {
  const directory = options.directory ?? tmpdir();
  const prefix = options.prefix ?? "lucent-";
  const pathPrefix =
    prefix === "" ? `${directory}${sep}` : join(directory, prefix);
  return fromMutationPromise(
    "make-temp-directory",
    pathTarget(pathPrefix),
    () => fs.mkdtemp(pathPrefix),
  );
};

const removeDirectory: DesktopFileSystem["Service"]["removeDirectory"] = (
  path,
  options,
) =>
  options.recursive
    ? removeDirectoryTree(path, true, options.ifMissing)
    : Effect.gen(function* () {
        const info = yield* ignoreMissing(
          fromPromise("remove-directory", pathTarget(path), () =>
            fs.lstat(path),
          ),
          options.ifMissing,
        );
        if (info === undefined) return;
        if (!info.isDirectory()) {
          return yield* makeError(
            "remove-directory",
            pathTarget(path),
            new ExpectedDirectoryError(`Expected a directory at ${path}.`),
          );
        }
        yield* ignoreMissing(
          fromMutationPromise("remove-directory", pathTarget(path), () =>
            fs.rmdir(path),
          ),
          options.ifMissing,
        );
      });

const service = DesktopFileSystem.of({
  exists: (path) =>
    fromPromise("exists", pathTarget(path), () => fs.stat(path)).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        isEffectivelyMissing(error)
          ? Effect.succeed(false)
          : Effect.fail(error),
      ),
    ),
  makeDirectory: (path, options) =>
    fromMutationPromise("make-directory", pathTarget(path), () =>
      fs
        .mkdir(path, {
          recursive: options.recursive,
          ...(options.mode === undefined ? {} : { mode: options.mode }),
        })
        .then(() => undefined),
    ),
  makeTempDirectory,
  readFile: (path, options) =>
    fromPromise("read", pathTarget(path), () =>
      readBounded(path, options.maxBytes),
    ),
  readDirectory: (path) =>
    fromPromise("list-directory", pathTarget(path), () =>
      fs
        .readdir(path, { withFileTypes: true })
        .then((entries): readonly DesktopDirectoryEntry[] =>
          entries.map((entry) => ({
            name: entry.name,
            kindHint: fileKind(entry),
          })),
        ),
    ),
  stat: (path) =>
    fromPromise("stat", pathTarget(path), () => fs.stat(path).then(fileInfo)),
  lstat: (path) =>
    fromPromise("lstat", pathTarget(path), () => fs.lstat(path).then(fileInfo)),
  realPath: (path) =>
    fromPromise("real-path", pathTarget(path), () => fs.realpath(path)),
  writeFile: (path, data, options) =>
    fromMutationPromise("write", pathTarget(path), () =>
      fs.writeFile(path, data, {
        flag: writeFlags[options.disposition],
        ...(options.mode === undefined ? {} : { mode: options.mode }),
      }),
    ),
  copyFile: (source, destination, options) =>
    fromMutationPromise("copy", pathPairTarget(source, destination), () =>
      fs.copyFile(
        source,
        destination,
        options.disposition === "create-new" ? constants.COPYFILE_EXCL : 0,
      ),
    ),
  rename: (source, destination) =>
    fromMutationPromise("rename", pathPairTarget(source, destination), () =>
      fs.rename(source, destination),
    ),
  removeFile: (path, options) =>
    ignoreMissing(
      fromMutationPromise("remove-file", pathTarget(path), () =>
        fs.unlink(path),
      ),
      options.ifMissing,
    ),
  removeDirectory,
});

export const layer = Layer.succeed(DesktopFileSystem, service);
