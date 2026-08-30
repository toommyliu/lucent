import * as Schema from "effect/Schema";

export const SCRIPT_FILE_SYSTEM_MAX_BYTES = 8 * 1024 * 1024;
export const SCRIPT_FILE_SYSTEM_MAX_ENTRIES = 1_000;

export const FileSystemOperationSchema = Schema.Literals([
  "exists",
  "list",
  "read-json",
  "read-text",
  "remove",
  "write-json",
  "write-text",
]);

export type FileSystemOperation = typeof FileSystemOperationSchema.Type;

export const FileSystemErrorReasonSchema = Schema.Literals([
  "invalid-path",
  "not-found",
  "not-file",
  "not-directory",
  "directory-not-empty",
  "too-large",
  "too-many-entries",
  "invalid-utf8",
  "invalid-json",
  "not-json-serializable",
  "permission-denied",
  "busy",
  "session-closed",
  "unavailable",
]);

export type FileSystemErrorReason = typeof FileSystemErrorReasonSchema.Type;

const FileSystemErrorFields = {
  operation: FileSystemOperationSchema,
  path: Schema.optionalKey(Schema.String),
  reason: FileSystemErrorReasonSchema,
} as const;

export const FileSystemFailureSchema = Schema.Struct(FileSystemErrorFields);

export type FileSystemFailure = typeof FileSystemFailureSchema.Type;

/** Describes a failed filesystem action. */
export class FileSystemError extends Schema.TaggedErrorClass<FileSystemError>()(
  "FileSystemError",
  FileSystemErrorFields,
) {
  override get message(): string {
    const target = this.path === undefined ? "" : ` at ${this.path}`;
    return `Filesystem ${this.operation} failed${target}: ${this.reason}.`;
  }
}

export const FileSystemEntrySchema = Schema.Struct({
  kind: Schema.Literals(["file", "directory", "symbolic-link", "other"]),
  name: Schema.String,
});

export type FileSystemEntry = typeof FileSystemEntrySchema.Type;
