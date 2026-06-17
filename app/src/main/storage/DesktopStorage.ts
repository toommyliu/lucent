import { promises as fs } from "fs";
import { dirname } from "path";
import * as YAML from "yaml";
import { Data, Effect, Layer, ServiceMap, SynchronizedRef } from "effect";
import { makeRandomId } from "../../shared/random-id";

export class DesktopStorageError extends Data.TaggedError(
  "DesktopStorageError",
)<{
  readonly path: string;
  readonly operation: "read" | "write" | "rename" | "mkdir" | "unlink";
  readonly cause: unknown;
}> {}

export class StorageParseError extends Data.TaggedError("StorageParseError")<{
  readonly path: string;
  readonly format: "json" | "yaml";
  readonly cause: unknown;
}> {}

export type StorageReadResult =
  | { readonly status: "missing" }
  | { readonly status: "malformed"; readonly error: StorageParseError }
  | { readonly status: "ok"; readonly value: unknown };

export interface DesktopJsonFile<A> {
  readonly path: string;
  readonly get: Effect.Effect<A, DesktopStorageError>;
  readonly set: (value: A) => Effect.Effect<A, DesktopStorageError>;
  readonly update: (
    f: (value: A) => A,
  ) => Effect.Effect<A, DesktopStorageError>;
}

export interface DesktopJsonFileOptions<A> {
  readonly path: string;
  readonly defaults: () => A;
  readonly normalize: (value: unknown) => A;
  readonly serialize?: (value: A) => unknown;
  readonly onMalformed?: (input: {
    readonly path: string;
    readonly quarantinePath: string | null;
    readonly error: StorageParseError;
  }) => Effect.Effect<void>;
}

export interface DesktopStorageShape {
  readonly readText: (
    path: string,
  ) => Effect.Effect<string | undefined, DesktopStorageError>;
  readonly writeTextAtomic: (
    path: string,
    source: string,
  ) => Effect.Effect<void, DesktopStorageError>;
  readonly readJson: (
    path: string,
  ) => Effect.Effect<StorageReadResult, DesktopStorageError>;
  readonly writeJson: (
    path: string,
    value: unknown,
  ) => Effect.Effect<void, DesktopStorageError>;
  readonly readYaml: (
    path: string,
  ) => Effect.Effect<StorageReadResult, DesktopStorageError>;
  readonly writeYaml: (
    path: string,
    value: unknown,
  ) => Effect.Effect<void, DesktopStorageError>;
  readonly quarantineMalformed: (
    path: string,
    reason: string,
  ) => Effect.Effect<string | null, DesktopStorageError>;
  readonly makeJsonFile: <A>(
    options: DesktopJsonFileOptions<A>,
  ) => Effect.Effect<DesktopJsonFile<A>>;
}

export class DesktopStorage extends ServiceMap.Service<
  DesktopStorage,
  DesktopStorageShape
>()("main/DesktopStorage") {}

const YAML_PARSE_OPTIONS = {
  schema: "core",
  uniqueKeys: true,
  version: "1.2",
} as const;

const YAML_STRINGIFY_OPTIONS = {
  aliasDuplicateObjects: false,
  indent: 2,
  lineWidth: 0,
} as const;

const isYamlExplicitTag = (tag: unknown): boolean =>
  typeof tag === "string" && tag.length > 0;

const assertSafeYamlDocument = (document: YAML.Document.Parsed): void => {
  let unsafeReason: string | undefined;

  YAML.visit(document, (_key, node) => {
    if (node === null || typeof node !== "object") {
      return undefined;
    }

    if (YAML.isAlias(node)) {
      unsafeReason = "YAML aliases are not supported";
      return YAML.visit.BREAK;
    }

    if (isYamlExplicitTag((node as { readonly tag?: unknown }).tag)) {
      unsafeReason = "YAML tags are not supported";
      return YAML.visit.BREAK;
    }

    return undefined;
  });

  if (unsafeReason !== undefined) {
    throw new Error(unsafeReason);
  }
};

export const parseYamlSource = (source: string): unknown => {
  const document = YAML.parseDocument(source, YAML_PARSE_OPTIONS);
  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  assertSafeYamlDocument(document);
  return document.toJSON();
};

const stringifyJson = (
  path: string,
  value: unknown,
): Effect.Effect<string, DesktopStorageError> =>
  Effect.try({
    try: () => {
      const source = JSON.stringify(value, null, 2);
      if (source === undefined) {
        throw new Error("Value is not JSON serializable");
      }
      return `${source}\n`;
    },
    catch: (cause) =>
      new DesktopStorageError({ path, operation: "write", cause }),
  });

const assertYamlSerializable = (
  value: unknown,
  ancestors = new WeakSet<object>(),
): void => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("YAML config values must be finite numbers");
    }
    return;
  }

  if (typeof value !== "object") {
    throw new Error("YAML config values must be JSON-compatible");
  }

  if (ancestors.has(value)) {
    throw new Error("YAML config values must not contain cycles");
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertYamlSerializable(item, ancestors);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("YAML config objects must be plain objects");
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (key.length === 0) {
        throw new Error("YAML config object keys must not be empty");
      }
      assertYamlSerializable(nestedValue, ancestors);
    }
  }
  ancestors.delete(value);
};

const withTrailingNewline = (source: string): string =>
  source.endsWith("\n") ? source : `${source}\n`;

const makeDesktopStorageError = (
  path: string,
  operation: DesktopStorageError["operation"],
  cause: unknown,
) => new DesktopStorageError({ path, operation, cause });

export const makeDesktopStorage = (): DesktopStorageShape => {
  const readText: DesktopStorageShape["readText"] = (path) =>
    Effect.tryPromise({
      try: async () => {
        try {
          return await fs.readFile(path, "utf8");
        } catch (cause) {
          if (
            typeof cause === "object" &&
            cause !== null &&
            (cause as { readonly code?: unknown }).code === "ENOENT"
          ) {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) => {
        return makeDesktopStorageError(path, "read", cause);
      },
    });

  const writeTextAtomic: DesktopStorageShape["writeTextAtomic"] = (
    path,
    source,
  ) => {
    const tempPath = `${path}.${process.pid}.${makeRandomId()}.tmp`;

    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => fs.mkdir(dirname(path), { recursive: true }),
        catch: (cause) => makeDesktopStorageError(path, "mkdir", cause),
      });

      yield* Effect.tryPromise({
        try: () => fs.writeFile(tempPath, source, "utf8"),
        catch: (cause) => makeDesktopStorageError(tempPath, "write", cause),
      }).pipe(
        Effect.catch((error: DesktopStorageError) =>
          Effect.tryPromise({
            try: () => fs.unlink(tempPath),
            catch: (cause) =>
              makeDesktopStorageError(tempPath, "unlink", cause),
          }).pipe(
            Effect.catch(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );

      yield* Effect.tryPromise({
        try: () => fs.rename(tempPath, path),
        catch: (cause) => makeDesktopStorageError(path, "rename", cause),
      }).pipe(
        Effect.catch((error: DesktopStorageError) =>
          Effect.tryPromise({
            try: () => fs.unlink(tempPath),
            catch: (cause) =>
              makeDesktopStorageError(tempPath, "unlink", cause),
          }).pipe(
            Effect.catch(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );
    });
  };

  const readJson: DesktopStorageShape["readJson"] = (path) =>
    Effect.gen(function* () {
      const source = yield* readText(path);
      if (source === undefined) {
        return { status: "missing" } as const;
      }

      try {
        return { status: "ok", value: JSON.parse(source) as unknown } as const;
      } catch (cause) {
        return {
          status: "malformed",
          error: new StorageParseError({ path, format: "json", cause }),
        } as const;
      }
    });

  const writeJson: DesktopStorageShape["writeJson"] = (path, value) =>
    stringifyJson(path, value).pipe(
      Effect.flatMap((source) => writeTextAtomic(path, source)),
    );

  const readYaml: DesktopStorageShape["readYaml"] = (path) =>
    Effect.gen(function* () {
      const source = yield* readText(path);
      if (source === undefined) {
        return { status: "missing" } as const;
      }

      try {
        return { status: "ok", value: parseYamlSource(source) } as const;
      } catch (cause) {
        return {
          status: "malformed",
          error: new StorageParseError({ path, format: "yaml", cause }),
        } as const;
      }
    });

  const writeYaml: DesktopStorageShape["writeYaml"] = (path, value) => {
    try {
      assertYamlSerializable(value);
      return writeTextAtomic(
        path,
        withTrailingNewline(YAML.stringify(value, YAML_STRINGIFY_OPTIONS)),
      );
    } catch (cause) {
      return Effect.fail(makeDesktopStorageError(path, "write", cause));
    }
  };

  const quarantineMalformed: DesktopStorageShape["quarantineMalformed"] = (
    path,
    reason,
  ) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const quarantinePath = `${path}.corrupt-${timestamp}-${makeRandomId()}`;

    return Effect.tryPromise({
      try: async () => {
        try {
          await fs.rename(path, quarantinePath);
          return quarantinePath;
        } catch (cause) {
          if (
            typeof cause === "object" &&
            cause !== null &&
            (cause as { readonly code?: unknown }).code === "ENOENT"
          ) {
            return null;
          }
          throw cause;
        }
      },
      catch: (cause) => {
        return makeDesktopStorageError(path, "rename", { reason, cause });
      },
    });
  };

  const makeJsonFile: DesktopStorageShape["makeJsonFile"] = <A>({
    path,
    defaults,
    normalize,
    serialize = (value: A): unknown => value,
    onMalformed,
  }: DesktopJsonFileOptions<A>) =>
    Effect.gen(function* () {
      const ref = yield* SynchronizedRef.make<A | null>(null);

      const load = Effect.gen(function* () {
        const result = yield* readJson(path);
        if (result.status === "missing") {
          return defaults();
        }

        if (result.status === "malformed") {
          const fallback = defaults();
          const quarantinePath = yield* quarantineMalformed(
            path,
            result.error.message,
          );
          if (onMalformed) {
            yield* onMalformed({ path, quarantinePath, error: result.error });
          }
          yield* writeJson(path, serialize(fallback));
          return fallback;
        }

        return normalize(result.value);
      });

      const set = (value: A) =>
        SynchronizedRef.modifyEffect(ref, () =>
          Effect.gen(function* () {
            const normalized = normalize(serialize(value));
            yield* writeJson(path, serialize(normalized));
            return [normalized, normalized] as const;
          }),
        );

      const update = (f: (value: A) => A) =>
        SynchronizedRef.modifyEffect(ref, (current) =>
          Effect.gen(function* () {
            const base = current ?? (yield* load);
            const normalized = normalize(serialize(f(base)));
            yield* writeJson(path, serialize(normalized));
            return [normalized, normalized] as const;
          }),
        );

      return {
        path,
        get: SynchronizedRef.modifyEffect(ref, (current) =>
          (current === null ? load : Effect.succeed(current)).pipe(
            Effect.map((value) => [value, value] as const),
          ),
        ),
        set,
        update,
      };
    });

  return {
    readText,
    writeTextAtomic,
    readJson,
    writeJson,
    readYaml,
    writeYaml,
    quarantineMalformed,
    makeJsonFile,
  };
};

export const DesktopStorageLive = Layer.succeed(
  DesktopStorage,
  makeDesktopStorage(),
);
