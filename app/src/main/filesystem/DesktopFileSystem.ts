import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const operationSchema = Schema.Literals([
  "copy",
  "exists",
  "list-directory",
  "lstat",
  "make-directory",
  "make-temp-directory",
  "read",
  "real-path",
  "remove-directory",
  "remove-file",
  "rename",
  "stat",
  "write",
]);

const reasonSchema = Schema.Literals([
  "AlreadyExists",
  "BadResource",
  "Busy",
  "CrossDevice",
  "DirectoryNotEmpty",
  "InvalidInput",
  "IsDirectory",
  "NoSpace",
  "NotDirectory",
  "NotFound",
  "PermissionDenied",
  "TooLarge",
  "Unknown",
]);

const targetSchema = Schema.Union([
  Schema.TaggedStruct("PathTarget", {
    path: Schema.String,
  }),
  Schema.TaggedStruct("PathPairTarget", {
    source: Schema.String,
    destination: Schema.String,
  }),
]);

export type DesktopFileSystemOperation = typeof operationSchema.Type;
export type DesktopFileSystemReason = typeof reasonSchema.Type;
export type DesktopFileSystemTarget = typeof targetSchema.Type;

export class DesktopFileSystemError extends Schema.TaggedError<DesktopFileSystemError>()(
  "DesktopFileSystemError",
  {
    operation: operationSchema,
    target: targetSchema,
    reason: reasonSchema,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const target =
      "path" in this.target
        ? this.target.path
        : `${this.target.source} -> ${this.target.destination}`;
    return `Filesystem ${this.operation} failed at ${target}: ${this.reason}.`;
  }
}

export type DesktopFileKind = "file" | "directory" | "symbolic-link" | "other";

export interface DesktopFileInfo {
  readonly kind: DesktopFileKind;
  readonly sizeBytes: number;
  readonly mode: number;
  readonly device: number;
  readonly inode: number;
  readonly modifiedTimeMs: number;
  readonly changedTimeMs: number;
  readonly birthTimeMs: number;
}

/** The kind is a directory-enumeration hint, not a security decision. */
export interface DesktopDirectoryEntry {
  readonly name: string;
  readonly kindHint: DesktopFileKind;
}

export type WriteFileDisposition =
  | "create-new"
  | "truncate-or-create"
  | "append-or-create";

export type CopyFileDisposition = "create-new" | "overwrite-or-create";

export type MissingPathBehavior = "fail" | "ignore";

interface DesktopFileSystemShape {
  /**
   * Observes without reserving. Use it for display or branching, not as a
   * preflight check before an outcome-sensitive operation.
   */
  readonly exists: (
    path: string,
  ) => Effect.Effect<boolean, DesktopFileSystemError>;
  readonly makeDirectory: (
    path: string,
    options: { readonly recursive: boolean; readonly mode?: number },
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly makeTempDirectory: (options?: {
    readonly directory?: string;
    readonly prefix?: string;
  }) => Effect.Effect<string, DesktopFileSystemError>;
  readonly readFile: (
    path: string,
    options: { readonly maxBytes: number },
  ) => Effect.Effect<Uint8Array, DesktopFileSystemError>;
  readonly readDirectory: (
    path: string,
    options: {
      readonly filter?: (entry: DesktopDirectoryEntry) => boolean;
      readonly maxEntries: number;
    },
  ) => Effect.Effect<readonly DesktopDirectoryEntry[], DesktopFileSystemError>;
  readonly stat: (
    path: string,
  ) => Effect.Effect<DesktopFileInfo, DesktopFileSystemError>;
  readonly lstat: (
    path: string,
  ) => Effect.Effect<DesktopFileInfo, DesktopFileSystemError>;
  readonly realPath: (
    path: string,
  ) => Effect.Effect<string, DesktopFileSystemError>;
  readonly writeFile: (
    path: string,
    data: string | Uint8Array,
    options: {
      readonly disposition: WriteFileDisposition;
      readonly mode?: number;
    },
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly copyFile: (
    source: string,
    destination: string,
    options: { readonly disposition: CopyFileDisposition },
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly rename: (
    source: string,
    destination: string,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly removeFile: (
    path: string,
    options: { readonly ifMissing: MissingPathBehavior },
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly removeDirectory: (
    path: string,
    options: {
      readonly recursive: boolean;
      readonly ifMissing: MissingPathBehavior;
    },
  ) => Effect.Effect<void, DesktopFileSystemError>;
}

export class DesktopFileSystem extends Context.Service<
  DesktopFileSystem,
  DesktopFileSystemShape
>()("lucent/desktop/filesystem/DesktopFileSystem") {}
