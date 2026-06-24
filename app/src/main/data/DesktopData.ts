import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import { dirname } from "path";

import { Context, Effect, Layer, Schema, SynchronizedRef } from "effect";

import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  serializeAppSettings,
  type AppSettings,
} from "../../shared/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";

export type JsonFileReadResult =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly value: unknown };

const dataOperationSchema = Schema.Literals([
  "mkdir",
  "parse",
  "read",
  "rename",
  "unlink",
  "write",
]);
type DesktopDataOperation = typeof dataOperationSchema.Type;

export class DesktopDataError extends Schema.TaggedErrorClass<DesktopDataError>()(
  "DesktopDataError",
  {
    operation: dataOperationSchema,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop data ${this.operation} failed at ${this.path}.`;
  }
}

export interface DesktopDataShape {
  readonly getSettings: Effect.Effect<AppSettings, DesktopDataError>;
  readonly loadSettings: Effect.Effect<AppSettings, DesktopDataError>;
  readonly readJson: (
    path: string,
  ) => Effect.Effect<JsonFileReadResult, DesktopDataError>;
  readonly saveSettings: (
    settings: AppSettings,
  ) => Effect.Effect<AppSettings, DesktopDataError>;
  readonly writeJson: (
    path: string,
    value: unknown,
  ) => Effect.Effect<void, DesktopDataError>;
}

export class DesktopData extends Context.Service<
  DesktopData,
  DesktopDataShape
>()("lucent/desktop/data/DesktopData") {}

const makeError = (
  path: string,
  operation: DesktopDataOperation,
  cause: unknown,
) => new DesktopDataError({ operation, path, cause });

const isMissingFile = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const stringifyJson = (
  path: string,
  value: unknown,
): Effect.Effect<string, DesktopDataError> =>
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

const makeDesktopData = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const settingsRef = yield* SynchronizedRef.make<AppSettings | null>(null);

  const writeTextAtomic = (
    path: string,
    source: string,
  ): Effect.Effect<void, DesktopDataError> => {
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
        Effect.catch((error: DesktopDataError) =>
          cleanupTemp.pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );

      yield* Effect.tryPromise({
        try: () => fs.rename(tempPath, path),
        catch: (cause) => makeError(path, "rename", cause),
      }).pipe(
        Effect.catch((error: DesktopDataError) =>
          cleanupTemp.pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
    });
  };

  const writeJson: DesktopDataShape["writeJson"] = (path, value) =>
    stringifyJson(path, value).pipe(
      Effect.flatMap((source) => writeTextAtomic(path, source)),
    );

  const readJson: DesktopDataShape["readJson"] = (path) =>
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

  const loadSettings = Effect.gen(function* () {
    const result = yield* readJson(env.settingsPath);
    if (result.status === "missing") {
      yield* writeJson(
        env.settingsPath,
        serializeAppSettings(DEFAULT_APP_SETTINGS),
      );
      return DEFAULT_APP_SETTINGS;
    }

    const settings = normalizeAppSettings(result.value);
    yield* writeJson(env.settingsPath, serializeAppSettings(settings));
    return settings;
  }).pipe(Effect.tap((settings) => SynchronizedRef.set(settingsRef, settings)));

  const getSettings = SynchronizedRef.get(settingsRef).pipe(
    Effect.flatMap((current) =>
      current === null ? loadSettings : Effect.succeed(current),
    ),
  );

  const saveSettings: DesktopDataShape["saveSettings"] = (settings) => {
    const normalized = normalizeAppSettings(settings);
    return writeJson(env.settingsPath, serializeAppSettings(normalized)).pipe(
      Effect.tap(() => SynchronizedRef.set(settingsRef, normalized)),
      Effect.as(normalized),
    );
  };

  return DesktopData.of({
    getSettings,
    loadSettings,
    readJson,
    saveSettings,
    writeJson,
  });
});

export const layer = Layer.effect(DesktopData, makeDesktopData);
