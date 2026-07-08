import { Context, Effect, Layer, Schema } from "effect";

import {
  normalizeScriptInputValues,
  type ScriptInputsDefinition,
  type ScriptInputValues,
} from "@lucent/core/scriptInputs";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import {
  type JsonFileError,
  readJsonFile,
  writeJsonFile,
} from "../settings/JsonFile";

const inputRepositoryOperationSchema = Schema.Literals(["read", "write"]);

export class ScriptInputRepositoryError extends Schema.TaggedErrorClass<ScriptInputRepositoryError>()(
  "ScriptInputRepositoryError",
  {
    operation: inputRepositoryOperationSchema,
    detail: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ScriptInputRepositoryShape {
  readonly getValues: (
    definition: ScriptInputsDefinition,
  ) => Effect.Effect<ScriptInputValues, ScriptInputRepositoryError>;
  readonly saveValues: (
    definition: ScriptInputsDefinition,
    values: ScriptInputValues,
  ) => Effect.Effect<ScriptInputValues, ScriptInputRepositoryError>;
}

export class ScriptInputRepository extends Context.Service<
  ScriptInputRepository,
  ScriptInputRepositoryShape
>()("lucent/desktop/scripting/ScriptInputRepository") {}

type Store = Record<string, Record<string, unknown>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const wrapJsonError = (
  operation: "read" | "write",
  error: JsonFileError,
): ScriptInputRepositoryError =>
  new ScriptInputRepositoryError({
    operation,
    detail: error.message,
    cause: error,
  });

const readStore = (
  path: string,
): Effect.Effect<Store, ScriptInputRepositoryError> =>
  readJsonFile(path).pipe(
    Effect.mapError((error: JsonFileError) => wrapJsonError("read", error)),
    Effect.map((result) => {
      if (result.status === "missing" || !isRecord(result.value)) {
        return {};
      }

      const store: Store = {};
      for (const [key, value] of Object.entries(result.value)) {
        if (isRecord(value)) {
          store[key] = value;
        }
      }
      return store;
    }),
  );

const writeStore = (
  path: string,
  store: Store,
): Effect.Effect<void, ScriptInputRepositoryError> =>
  writeJsonFile(path, store).pipe(
    Effect.mapError((error: JsonFileError) => wrapJsonError("write", error)),
  );

export const layer = Layer.effect(
  ScriptInputRepository,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const path = env.appDataPath("script-inputs.json");

    return ScriptInputRepository.of({
      getValues: (definition) =>
        readStore(path).pipe(
          Effect.map((store) =>
            normalizeScriptInputValues(definition, store[definition.id] ?? {}),
          ),
        ),
      saveValues: (definition, values) =>
        Effect.gen(function* () {
          const normalized = normalizeScriptInputValues(definition, values);
          const store = yield* readStore(path);
          store[definition.id] = normalized;
          yield* writeStore(path, store);
          return normalized;
        }),
    });
  }),
);
