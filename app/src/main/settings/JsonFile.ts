import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import { dirname } from "path";

import { Effect, Schema } from "effect";

export type JsonFileReadResult =
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

export type JsonFileOperation = typeof jsonFileOperationSchema.Type;

export class JsonFileError extends Schema.TaggedErrorClass<JsonFileError>()(
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
) => new JsonFileError({ operation, path, cause });

const isMissingFile = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const stringifyJson = (
  path: string,
  value: unknown,
): Effect.Effect<string, JsonFileError> =>
  Effect.try({
    try: () => {
      const source = JSON.stringify(value, null, 2);
      if (source === undefined) {
        throw new Error("Value is not JSON serializable");
      }
      return `${source}\n`;
    },
    catch: (cause) => makeError(path, "write", cause),
  });

const writeTextAtomic = (
  path: string,
  source: string,
): Effect.Effect<void, JsonFileError> => {
  const tempPath = `${path}.${process.pid}.${randomBytes(16).toString(
    "hex",
  )}.tmp`;

  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => fs.mkdir(dirname(path), { recursive: true }),
      catch: (cause) => makeError(path, "mkdir", cause),
    });

    const cleanupTemp = Effect.tryPromise({
      try: () => fs.unlink(tempPath),
      catch: (cause) => makeError(tempPath, "unlink", cause),
    }).pipe(Effect.catch(() => Effect.void));

    yield* Effect.tryPromise({
      try: () => fs.writeFile(tempPath, source, "utf8"),
      catch: (cause) => makeError(tempPath, "write", cause),
    }).pipe(
      Effect.catch((error: JsonFileError) =>
        cleanupTemp.pipe(Effect.flatMap(() => Effect.fail(error))),
      ),
    );

    yield* Effect.tryPromise({
      try: () => fs.rename(tempPath, path),
      catch: (cause) => makeError(path, "rename", cause),
    }).pipe(
      Effect.catch((error: JsonFileError) =>
        cleanupTemp.pipe(Effect.flatMap(() => Effect.fail(error))),
      ),
    );
  });
};

export const readJsonFile = (
  path: string,
): Effect.Effect<JsonFileReadResult, JsonFileError> =>
  Effect.tryPromise({
    try: () => fs.readFile(path, "utf8"),
    catch: (cause) => makeError(path, "read", cause),
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        isMissingFile(error.cause)
          ? Effect.succeed({ status: "missing" as const })
          : Effect.fail(error),
      onSuccess: (source) =>
        Effect.try({
          try: () => ({ status: "ok", value: JSON.parse(source) }) as const,
          catch: (cause) => makeError(path, "parse", cause),
        }),
    }),
  );

export const writeJsonFile = (
  path: string,
  value: unknown,
): Effect.Effect<void, JsonFileError> =>
  stringifyJson(path, value).pipe(
    Effect.flatMap((source) => writeTextAtomic(path, source)),
  );
