import { join } from "path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  normalizeScriptInputValues,
  type ScriptInputsDefinition,
  type ScriptInputValues,
} from "@lucent/core/scriptInputs";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import {
  type JsonFileError,
  readJsonFile,
  writeJsonFile,
} from "../../settings/JsonFile";

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
>()("lucent/internal/scripting/ScriptInputRepository") {}

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
type UnknownRecord = typeof UnknownRecordSchema.Type;
type Store = Record<string, UnknownRecord>;
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecordSchema);

const decodeStore = (value: unknown): Store => {
  const decodedStore = decodeUnknownRecord(value);
  if (Option.isNone(decodedStore)) {
    return {};
  }

  const store: Store = {};
  for (const [key, entry] of Object.entries(decodedStore.value)) {
    const decodedEntry = decodeUnknownRecord(entry);
    if (Option.isSome(decodedEntry)) {
      store[key] = decodedEntry.value;
    }
  }
  return store;
};

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
      if (result.status === "missing") return {};
      return decodeStore(result.value);
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
    const path = join(env.appDataDir, "script-inputs.json");
    const writes = yield* Semaphore.make(1);

    const getValues = (definition: ScriptInputsDefinition) =>
      readStore(path).pipe(
        Effect.map((store) =>
          normalizeScriptInputValues(definition, store[definition.id] ?? {}),
        ),
      );

    const saveValues = (
      definition: ScriptInputsDefinition,
      values: ScriptInputValues,
    ) =>
      writes.withPermits(1)(
        Effect.gen(function* () {
          const normalized = normalizeScriptInputValues(definition, values);
          const store = yield* readStore(path);
          yield* writeStore(path, {
            ...store,
            [definition.id]: normalized,
          });
          return normalized;
        }),
      );

    return ScriptInputRepository.of({
      getValues,
      saveValues,
    });
  }),
);
