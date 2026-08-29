import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

export const desktopFileSystemOperationSchema = Schema.Literals([
  "copy",
  "list",
  "make-directory",
  "make-temp",
  "open",
  "read",
  "real-path",
  "remove",
  "rename",
  "stat",
  "sync",
  "write",
]);
export type DesktopFileSystemOperation =
  typeof desktopFileSystemOperationSchema.Type;
export const desktopFileSystemReasonSchema = Schema.Literals([
  "AlreadyExists",
  "BadResource",
  "Busy",
  "CrossDevice",
  "NoSpace",
  "NotFound",
  "PermissionDenied",
  "TooLarge",
  "Unknown",
]);
export type DesktopFileSystemReason = typeof desktopFileSystemReasonSchema.Type;

export class DesktopFileSystemError extends Schema.TaggedErrorClass<DesktopFileSystemError>()(
  "DesktopFileSystemError",
  {
    operation: desktopFileSystemOperationSchema,
    path: Schema.String,
    destination: Schema.optionalKey(Schema.String),
    reason: desktopFileSystemReasonSchema,
    cause: Schema.Defect(),
  },
) {}

export interface DesktopFileInfo {
  readonly type: "file" | "directory" | "symbolic-link" | "other";
  readonly size: number;
  readonly mode: number;
  readonly device: number;
  readonly inode: number;
  readonly modifiedTimeMs: number;
  readonly changedTimeMs: number;
  readonly birthTimeMs: number;
}

export interface DesktopDirectoryEntry {
  readonly name: string;
  readonly type: DesktopFileInfo["type"];
}

export interface DesktopFileSystemShape {
  readonly makeDirectory: (
    path: string,
    options?: Readonly<{ recursive?: boolean; mode?: number }>,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly makeTempDirectory: (
    options?: Readonly<{ directory?: string; prefix?: string }>,
  ) => Effect.Effect<string, DesktopFileSystemError>;
  readonly makeTempDirectoryScoped: (
    options?: Readonly<{ directory?: string; prefix?: string }>,
  ) => Effect.Effect<string, DesktopFileSystemError, Scope.Scope>;
  readonly readFile: (
    path: string,
    options: Readonly<{ maxBytes: number }>,
  ) => Effect.Effect<Uint8Array, DesktopFileSystemError>;
  readonly readTextFile: (
    path: string,
    options: Readonly<{ maxBytes: number }>,
  ) => Effect.Effect<string, DesktopFileSystemError>;
  readonly readDirectory: (
    path: string,
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
    data: Uint8Array | string,
    options?: Readonly<{ exclusive?: boolean; mode?: number }>,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly copyFile: (
    source: string,
    destination: string,
    options?: Readonly<{ exclusive?: boolean }>,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly rename: (
    source: string,
    destination: string,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly removeFile: (
    path: string,
    options?: Readonly<{ ignoreMissing?: boolean }>,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly removeDirectory: (
    path: string,
    options?: Readonly<{ recursive?: boolean; ignoreMissing?: boolean }>,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly syncFile: (
    path: string,
  ) => Effect.Effect<void, DesktopFileSystemError>;
  readonly syncDirectory: (
    path: string,
  ) => Effect.Effect<
    { readonly status: "synced" | "unsupported" },
    DesktopFileSystemError
  >;
}

export class DesktopFileSystem extends Context.Service<
  DesktopFileSystem,
  DesktopFileSystemShape
>()("lucent/desktop/filesystem/DesktopFileSystem") {}

export const isDesktopFileSystemReason = (
  error: DesktopFileSystemError,
  reason: DesktopFileSystemReason,
): boolean => error.reason === reason;
export const isNotFound = (error: DesktopFileSystemError): boolean =>
  isDesktopFileSystemReason(error, "NotFound");
export const isAlreadyExists = (error: DesktopFileSystemError): boolean =>
  isDesktopFileSystemReason(error, "AlreadyExists");
