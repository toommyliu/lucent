import { promises as fs, type Dirent, type Stats } from "node:fs";
import * as Effect from "effect/Effect";
import { FileSystem } from "effect/FileSystem";
import * as Predicate from "effect/Predicate";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export class FileSystemLimitError extends Schema.TaggedError<FileSystemLimitError>()(
  "FileSystemLimitError",
  {
    path: Schema.String,
    limit: Schema.Number,
    kind: Schema.Literals(["bytes", "entries"]),
  },
) {}

export class FileChangedWhileReading extends Schema.TaggedError<FileChangedWhileReading>()(
  "FileChangedWhileReading",
  { path: Schema.String },
) {}

export class FileNotFound extends Schema.TaggedError<FileNotFound>()(
  "FileNotFound",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.cause instanceof Error
      ? this.cause.message
      : String(this.cause);
  }
}

export class NotRegularFile extends Schema.TaggedError<NotRegularFile>()(
  "NotRegularFile",
  {
    path: Schema.String,
  },
) {
  override get message(): string {
    return `Expected a regular file: ${this.path}.`;
  }
}

export type FileReadError = FileNotFound | PlatformError.PlatformError;

const isFileNotFound = Schema.is(FileNotFound);

export function nativeCause(error: PlatformError.PlatformError): {};
export function nativeCause(error: unknown): unknown;
export function nativeCause(error: unknown): unknown {
  return PlatformError.isPlatformError(error)
    ? (error.reason.cause ?? error)
    : isFileNotFound(error)
      ? error.cause
      : error;
}

export const fileReadError =
  (path: string) =>
  (error: PlatformError.PlatformError): FileReadError => {
    const cause = nativeCause(error);
    return Predicate.isTagged(error.reason, "NotFound") ||
      (Predicate.hasProperty(cause, "code") &&
        (cause.code === "ENOENT" || cause.code === "ENOTDIR"))
      ? new FileNotFound({ path, cause })
      : error;
  };

const statPath = (path: string) =>
  Effect.tryPromise({
    try: () => fs.stat(path),
    catch: (cause) => fileReadError(path)(nativeFileError("stat", path, cause)),
  });

export const regularFileFingerprint = Effect.fnUntraced(function* (
  path: string,
) {
  const stat = yield* statPath(path);
  if (!stat.isFile()) return yield* new NotRegularFile({ path });
  return fileFingerprint(stat);
});

export const fileFingerprint = (stat: Stats): string =>
  [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");

export const readFileBounded = Effect.fn("readFileBounded")(function* (
  fileSystem: FileSystem,
  path: string,
  maxBytes: number,
) {
  const chunks = yield* Stream.runCollect(
    fileSystem.stream(path, { bytesToRead: BigInt(maxBytes) + 1n }),
  );
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (size > maxBytes)
    return yield* new FileSystemLimitError({
      path,
      limit: maxBytes,
      kind: "bytes",
    });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
});

export const readStableFile = Effect.fnUntraced(function* (
  path: string,
  maxBytes: number,
  options: {
    readonly requireRegularFile?: boolean;
    readonly missingAfterReadIsChange?: boolean;
  } = {},
) {
  const fileSystem = yield* FileSystem;
  const stat = statPath(path);
  const before = yield* stat;
  if (options.requireRegularFile && !before.isFile())
    return yield* new NotRegularFile({ path });
  if (before.size > maxBytes)
    return yield* new FileSystemLimitError({
      path,
      limit: maxBytes,
      kind: "bytes",
    });
  const bytes = yield* readFileBounded(fileSystem, path, maxBytes).pipe(
    Effect.mapError((cause) =>
      cause._tag === "FileSystemLimitError"
        ? cause
        : fileReadError(path)(cause),
    ),
  );
  const after = yield* stat.pipe(
    Effect.mapError((cause) =>
      options.missingAfterReadIsChange && isFileNotFound(cause)
        ? new FileChangedWhileReading({ path })
        : cause,
    ),
  );
  const fingerprint = fileFingerprint(after);
  if (fileFingerprint(before) !== fingerprint)
    return yield* new FileChangedWhileReading({ path });
  return {
    contents: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    fingerprint,
  };
});

export const nativeFileError = (
  method: string,
  path: string,
  cause: unknown,
): PlatformError.PlatformError => {
  const code =
    cause instanceof Error && "code" in cause ? cause.code : undefined;
  return PlatformError.systemError({
    _tag:
      code === "ENOENT"
        ? "NotFound"
        : code === "EEXIST"
          ? "AlreadyExists"
          : code === "EACCES" || code === "EPERM" || code === "EROFS"
            ? "PermissionDenied"
            : "Unknown",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    cause,
  });
};

export interface PathInfo {
  readonly kind: "file" | "directory" | "symbolic-link" | "other";
  readonly size: number;
  readonly mode: number;
}

export const lstatPath = Effect.fnUntraced(function* (path: string) {
  const info = yield* lstat(path).pipe(Effect.mapError(fileReadError(path)));
  return {
    kind: fileKind(info),
    size: info.size,
    mode: info.mode,
  } satisfies PathInfo;
});

export const realPath = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.tryPromise({
    try: () => fs.realpath(path),
    catch: (cause) =>
      fileReadError(path)(nativeFileError("realpath", path, cause)),
  });
});

export interface DirectoryEntry {
  readonly name: string;
  readonly kind: PathInfo["kind"];
}

export const readDirectoryEntries = Effect.fnUntraced(function* (path: string) {
  const entries = yield* Effect.tryPromise({
    try: () => fs.readdir(path, { withFileTypes: true }),
    catch: (cause) =>
      fileReadError(path)(nativeFileError("readdir", path, cause)),
  });
  return entries.map(
    (entry): DirectoryEntry => ({ name: entry.name, kind: fileKind(entry) }),
  );
});

export const pathExists = Effect.fnUntraced(function* (path: string) {
  return yield* lstatPath(path).pipe(
    Effect.as(true),
    Effect.catchTag("FileNotFound", () => Effect.succeed(false)),
  );
});

export const lstat = (path: string) =>
  Effect.tryPromise({
    try: () => fs.lstat(path),
    catch: (cause) => nativeFileError("lstat", path, cause),
  });

export const fileKind = (
  info: Stats | Dirent,
): "file" | "directory" | "symbolic-link" | "other" =>
  info.isFile()
    ? "file"
    : info.isDirectory()
      ? "directory"
      : info.isSymbolicLink()
        ? "symbolic-link"
        : "other";

export const readDirectoryBounded = Effect.fn("readDirectoryBounded")(
  function* (
    path: string,
    options: {
      readonly maxEntries: number;
      readonly include: (name: string) => boolean;
    },
  ) {
    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => fs.opendir(path),
        catch: (cause) => nativeFileError("opendir", path, cause),
      }),
      Effect.fn(function* (directory) {
        const entries: {
          readonly name: string;
          readonly kind: ReturnType<typeof fileKind>;
        }[] = [];
        while (true) {
          const entry = yield* Effect.tryPromise({
            try: () => directory.read(),
            catch: (cause) => nativeFileError("readdir", path, cause),
          }).pipe(Effect.uninterruptible);
          if (entry === null) return entries;
          if (!options.include(entry.name)) continue;
          if (entries.length === options.maxEntries)
            return yield* new FileSystemLimitError({
              path,
              limit: options.maxEntries,
              kind: "entries",
            });
          entries.push({ name: entry.name, kind: fileKind(entry) });
        }
      }),
      (directory) => Effect.promise(() => directory.close()),
    );
  },
);

export const removeScriptPath = (path: string, directory: boolean) =>
  Effect.tryPromise({
    try: () => (directory ? fs.rmdir(path) : fs.unlink(path)),
    catch: (cause) =>
      nativeFileError(directory ? "rmdir" : "unlink", path, cause),
  }).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
    Effect.uninterruptible,
  );
