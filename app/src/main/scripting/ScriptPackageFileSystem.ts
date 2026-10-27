import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import * as Effect from "effect/Effect";
import { FileSystem } from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";

import {
  FileChangedWhileReading,
  fileReadError,
  lstatPath,
  readDirectoryEntries,
  type FileReadError,
  readStableFile as readStableFileEffect,
} from "../filesystem/BoundedFileSystem";

import {
  formatBytes,
  SCRIPT_PACKAGE_FILE_MAX_BYTES,
  SCRIPT_PACKAGE_MAX_FILES,
  SCRIPT_PACKAGE_MAX_BYTES,
} from "./ScriptLimits";

export class InvalidScriptPackage extends Schema.TaggedError<InvalidScriptPackage>()(
  "InvalidScriptPackage",
  {
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  static fromUnknown(cause: unknown, fallback: string): InvalidScriptPackage {
    return new InvalidScriptPackage({
      detail: cause instanceof Error ? cause.message : fallback,
      cause,
    });
  }

  override get message(): string {
    return this.detail;
  }
}

export interface RegularFilePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface ListRegularFilesOptions {
  readonly maxFiles?: number;
  readonly rejectSymlinks?: boolean;
}

const systemMetadataNames = new Set(["desktop.ini", "thumbs.db"]);

const isSystemMetadataFile = (name: string): boolean =>
  name === ".DS_Store" ||
  name === ".directory" ||
  name.startsWith("._") ||
  systemMetadataNames.has(name.toLowerCase());

export const portablePath = (value: string): string =>
  value.split(sep).join("/");

export const isPathInside = (root: string, candidate: string): boolean => {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const path = relative(normalizedRoot, normalizedCandidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
};

export type PackageFileError = FileReadError | InvalidScriptPackage;
export type PackageFileHashes = Readonly<Record<string, string>>;

const isFileChangedWhileReading = Schema.is(FileChangedWhileReading);

export const readPackageFile = Effect.fnUntraced(function* (
  path: string,
  maxBytes: number,
) {
  const stable = yield* readStableFileEffect(path, maxBytes, {
    requireRegularFile: true,
  }).pipe(
    Effect.retry({
      schedule: Schedule.recurs(2),
      while: isFileChangedWhileReading,
    }),
    Effect.catchTags({
      FileSystemLimitError: (cause) =>
        Effect.fail(
          new InvalidScriptPackage({
            detail: `File exceeds the ${formatBytes(maxBytes)} limit: ${path}.`,
            cause,
          }),
        ),
    }),
    Effect.catchTag(["NotRegularFile", "FileChangedWhileReading"], (cause) =>
      Effect.fail(new InvalidScriptPackage({ detail: cause.message, cause })),
    ),
  );
  return stable.contents;
});

const packageFileHash = (contents: Buffer): string =>
  `sha256-${sha256Revision(contents)}`;

export const sha256Revision = (contents: Buffer | string): string =>
  createHash("sha256").update(contents).digest("hex");

export const listRegularFilePaths = Effect.fnUntraced(function* (
  root: string,
  options: ListRegularFilesOptions = {},
) {
  const files: RegularFilePath[] = [];

  const visit = Effect.fnUntraced(function* (
    directory: string,
  ): Effect.fn.Return<void, FileReadError | InvalidScriptPackage> {
    const entries = (yield* readDirectoryEntries(directory)).sort(
      (left, right) =>
        left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );

    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.kind === "symbolic-link") {
        if (options.rejectSymlinks === true) {
          return yield* new InvalidScriptPackage({
            detail: `Symbolic links are not supported: ${path}.`,
          });
        }
        continue;
      }
      if (entry.kind === "directory") {
        yield* visit(path);
        continue;
      }
      if (entry.kind !== "file") continue;
      if (isSystemMetadataFile(entry.name)) continue;

      const relativePath = portablePath(relative(root, path));
      files.push({ absolutePath: path, relativePath });
      if (options.maxFiles !== undefined && files.length > options.maxFiles) {
        return yield* new InvalidScriptPackage({
          detail: `Directory contains more than ${options.maxFiles} files: ${root}.`,
        });
      }
    }
    return undefined;
  });

  return yield* visit(root).pipe(
    Effect.as(files),
    Effect.catchTag("FileNotFound", () => Effect.succeed([])),
  );
});

export const hashDirectory = Effect.fn("hashDirectory")(function* (
  root: string,
): Effect.fn.Return<PackageFileHashes, PackageFileError, FileSystem> {
  const inventory = yield* listRegularFilePaths(root, {
    maxFiles: SCRIPT_PACKAGE_MAX_FILES,
    rejectSymlinks: true,
  });
  const hashes = new Map<string, string>();
  for (const file of inventory) {
    const contents = yield* readPackageFile(
      file.absolutePath,
      SCRIPT_PACKAGE_FILE_MAX_BYTES,
    );
    hashes.set(file.relativePath, packageFileHash(contents));
  }
  return Object.fromEntries(hashes);
});

type GitEntry =
  | {
      readonly kind: "file";
      readonly hash: Buffer;
      readonly executable: boolean;
    }
  | { readonly kind: "directory"; readonly entries: Map<string, GitEntry> };

const gitObjectHash = (kind: "blob" | "tree", contents: Buffer): Buffer =>
  createHash("sha1")
    .update(`${kind} ${contents.byteLength}\0`)
    .update(contents)
    .digest();

// Git sorts directory names as though they have a trailing slash.
const gitTreeHash = (entries: ReadonlyMap<string, GitEntry>): Buffer => {
  const ordered = [...entries];
  ordered.sort(([leftName, left], [rightName, right]) =>
    Buffer.compare(
      Buffer.from(leftName + (left.kind === "directory" ? "/" : "")),
      Buffer.from(rightName + (right.kind === "directory" ? "/" : "")),
    ),
  );
  return gitObjectHash(
    "tree",
    Buffer.concat(
      ordered.flatMap(([name, entry]) => [
        Buffer.from(
          `${entry.kind === "directory" ? "40000" : entry.executable ? "100755" : "100644"} ${name}\0`,
        ),
        entry.kind === "directory" ? gitTreeHash(entry.entries) : entry.hash,
      ]),
    ),
  );
};

export const copyBundledScriptPackage = Effect.fn("copyBundledScriptPackage")(
  function* (
    source: string,
    destination: string,
  ): Effect.fn.Return<
    { readonly files: PackageFileHashes; readonly tree: string },
    PackageFileError,
    FileSystem
  > {
    const fileSystem = yield* FileSystem;
    const root = yield* lstatPath(source);
    if (root.kind !== "directory") {
      return yield* new InvalidScriptPackage({
        detail: "A bundled package must be a directory, not a symbolic link.",
      });
    }
    const inventory = yield* listRegularFilePaths(source, {
      maxFiles: SCRIPT_PACKAGE_MAX_FILES,
      rejectSymlinks: true,
    });
    const files = new Map<string, string>();
    const tree = new Map<string, GitEntry>();
    let totalBytes = 0;

    for (const file of inventory) {
      const contents = yield* readPackageFile(
        file.absolutePath,
        SCRIPT_PACKAGE_FILE_MAX_BYTES,
      );
      totalBytes += contents.byteLength;
      if (totalBytes > SCRIPT_PACKAGE_MAX_BYTES) {
        return yield* new InvalidScriptPackage({
          detail: `The bundled package exceeds the ${formatBytes(SCRIPT_PACKAGE_MAX_BYTES)} limit.`,
        });
      }
      const stat = yield* lstatPath(file.absolutePath);
      const executable = (stat.mode & 0o111) !== 0;
      const target = join(destination, file.relativePath);
      yield* fileSystem
        .makeDirectory(dirname(target), { recursive: true })
        .pipe(Effect.mapError(fileReadError(dirname(target))));
      yield* fileSystem
        .writeFile(target, contents, {
          flag: "wx",
          mode: executable ? 0o755 : 0o644,
        })
        .pipe(Effect.mapError(fileReadError(target)));
      files.set(file.relativePath, packageFileHash(contents));

      const parts = file.relativePath.split("/").slice(0, -1);
      let entries = tree;
      for (const part of parts) {
        const entry = entries.get(part);
        const directory =
          entry?.kind === "directory"
            ? entry
            : {
                kind: "directory" as const,
                entries: new Map<string, GitEntry>(),
              };
        entries.set(part, directory);
        entries = directory.entries;
      }
      entries.set(basename(file.relativePath), {
        kind: "file",
        hash: gitObjectHash("blob", contents),
        executable,
      });
    }
    return {
      files: Object.fromEntries(files),
      tree: gitTreeHash(tree).toString("hex"),
    };
  },
);
