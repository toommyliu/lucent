import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeAtomicFile } from "./AtomicFile";
import {
  type DesktopFileSystem,
  type DesktopFileSystemError,
} from "./DesktopFileSystem";

/** JSON state files are intentionally bounded to protect the main process. */
export const JSON_FILE_MAX_BYTES = 8 * 1024 * 1024;

type JsonFileReadResult =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly value: unknown };

const jsonFileOperationSchema = Schema.Literals([
  "mkdir",
  "parse",
  "read",
  "rename",
  "unlink",
  "write",
]);

type JsonFileOperation = typeof jsonFileOperationSchema.Type;

export class JsonFileError extends Schema.TaggedError<JsonFileError>()(
  "JsonFileError",
  {
    operation: jsonFileOperationSchema,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `JSON file ${this.operation} failed at ${this.path}.`;
  }
}

const makeError = (
  path: string,
  operation: JsonFileOperation,
  cause: unknown,
): JsonFileError => new JsonFileError({ operation, path, cause });

const atomicOperation = (error: DesktopFileSystemError): JsonFileOperation => {
  switch (error.operation) {
    case "make-directory":
      return "mkdir";
    case "rename":
      return "rename";
    case "remove-file":
      return "unlink";
    default:
      return "write";
  }
};

export const makeJsonFile = (fileSystem: DesktopFileSystem["Service"]) => {
  const atomicFile = makeAtomicFile(fileSystem);

  const read = Effect.fn("JsonFile.read")(function* (
    path: string,
  ): Effect.fn.Return<JsonFileReadResult, JsonFileError> {
    const bytes = yield* fileSystem
      .readFile(path, { maxBytes: JSON_FILE_MAX_BYTES })
      .pipe(
        Effect.catch((error) =>
          error.reason === "NotFound"
            ? Effect.void
            : Effect.fail(makeError(path, "read", error)),
        ),
      );
    if (bytes === undefined) return { status: "missing" };

    return yield* Effect.try({
      try: () =>
        ({
          status: "ok",
          value: JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown,
        }) as const,
      catch: (cause) => makeError(path, "parse", cause),
    });
  });

  const write = Effect.fn("JsonFile.write")(function* (
    path: string,
    value: unknown,
    options: { readonly mode?: number } = {},
  ): Effect.fn.Return<void, JsonFileError> {
    const source = yield* Effect.try({
      try: () => {
        const serialized = JSON.stringify(value, null, 2);
        if (serialized === undefined) {
          throw new Error("Value is not JSON serializable");
        }
        return `${serialized}\n`;
      },
      catch: (cause) => makeError(path, "write", cause),
    });

    yield* atomicFile
      .write(path, source, options)
      .pipe(
        Effect.mapError((error) =>
          makeError(path, atomicOperation(error), error),
        ),
      );
  });

  return { read, write };
};
