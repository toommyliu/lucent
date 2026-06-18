import { createHash } from "crypto";
import { join } from "path";
import { Effect, Layer, ServiceMap } from "effect";
import {
  mergeDeclaredScriptInputValues,
  normalizeScriptInputValues,
  type ScriptInputsDefinition,
  type ScriptInputStorageFile,
  type ScriptInputValues,
} from "../../../shared/script-inputs";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../../app/DesktopObservability";
import {
  DesktopStorage,
  type DesktopStorageError,
  type DesktopStorageShape,
} from "../../storage/DesktopStorage";
import { roundTimingMs, timingNow } from "../../timing";

const SCRIPT_INPUT_STORAGE_VERSION = 1;
const SCRIPT_INPUTS_DIR = "script-inputs";
const SCRIPT_INPUT_READ_WARN_MS = 50;
const SCRIPT_INPUT_WRITE_WARN_MS = 100;

export interface ScriptInputRepositoryShape {
  readonly inputsDir: string;
  readonly get: (
    definition: ScriptInputsDefinition,
  ) => Effect.Effect<ScriptInputValues, DesktopStorageError>;
  readonly set: (
    definition: ScriptInputsDefinition,
    values: ScriptInputValues,
  ) => Effect.Effect<ScriptInputValues, DesktopStorageError>;
}

export class ScriptInputRepository extends ServiceMap.Service<
  ScriptInputRepository,
  ScriptInputRepositoryShape
>()("main/backend/scripting/ScriptInputRepository") {}

export const scriptInputStorageFileName = (id: string): string =>
  `${createHash("sha256").update(id).digest("hex")}.json`;

const normalizeStorageFile = (
  definition: ScriptInputsDefinition,
  value: unknown,
): ScriptInputStorageFile => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      version: SCRIPT_INPUT_STORAGE_VERSION,
      id: definition.id,
      values: {},
      updatedAt: new Date(0).toISOString(),
    };
  }

  const input = value as Partial<ScriptInputStorageFile>;
  return {
    version: SCRIPT_INPUT_STORAGE_VERSION,
    id: typeof input.id === "string" ? input.id : definition.id,
    values: normalizeScriptInputValues(input.values),
    updatedAt:
      typeof input.updatedAt === "string"
        ? input.updatedAt
        : new Date(0).toISOString(),
  };
};

const observeTiming = (
  observability: Pick<DesktopObservabilityShape, "debug" | "warn">,
  operation: "read" | "write",
  data: {
    readonly id: string;
    readonly path: string;
    readonly durationMs: number;
    readonly fieldCount: number;
  },
) => {
  const threshold =
    operation === "read"
      ? SCRIPT_INPUT_READ_WARN_MS
      : SCRIPT_INPUT_WRITE_WARN_MS;
  const level = data.durationMs > threshold ? "warn" : "debug";
  const message =
    level === "warn"
      ? `Script input storage ${operation} was slow`
      : `Script input storage ${operation} completed`;
  return observability[level]("scripting", message, data).pipe(Effect.asVoid);
};

export const makeScriptInputRepository = (options: {
  readonly inputsDir: string;
  readonly storage: Pick<
    DesktopStorageShape,
    "readJson" | "writeJson" | "quarantineMalformed"
  >;
  readonly observability: Pick<DesktopObservabilityShape, "debug" | "warn">;
  readonly now?: () => Date;
}): ScriptInputRepositoryShape => {
  const now = options.now ?? (() => new Date());
  const pathFor = (definition: ScriptInputsDefinition): string =>
    join(options.inputsDir, scriptInputStorageFileName(definition.id));

  const readFile = (definition: ScriptInputsDefinition) =>
    Effect.gen(function* () {
      const startedAt = timingNow();
      const path = pathFor(definition);
      const result = yield* options.storage.readJson(path);
      let file: ScriptInputStorageFile;

      if (result.status === "missing") {
        file = {
          version: SCRIPT_INPUT_STORAGE_VERSION,
          id: definition.id,
          values: {},
          updatedAt: now().toISOString(),
        };
      } else if (result.status === "malformed") {
        const quarantinePath = yield* options.storage.quarantineMalformed(
          path,
          "malformed script input storage",
        );
        yield* options.observability.warn(
          "scripting",
          "Malformed script input storage file",
          {
            id: definition.id,
            path,
            quarantinePath,
            error: result.error,
          },
        );
        file = {
          version: SCRIPT_INPUT_STORAGE_VERSION,
          id: definition.id,
          values: {},
          updatedAt: now().toISOString(),
        };
      } else {
        file = normalizeStorageFile(definition, result.value);
      }

      if (file.id !== definition.id) {
        yield* options.observability.warn(
          "scripting",
          "Script input storage id mismatch",
          {
            expectedId: definition.id,
            actualId: file.id,
            path,
          },
        );
        file = { ...file, values: {}, id: definition.id };
      }

      const durationMs = roundTimingMs(timingNow() - startedAt);
      yield* observeTiming(options.observability, "read", {
        id: definition.id,
        path,
        durationMs,
        fieldCount: definition.fields.length,
      });

      return file;
    });

  const get: ScriptInputRepositoryShape["get"] = (definition) =>
    readFile(definition).pipe(Effect.map((file) => file.values));

  const set: ScriptInputRepositoryShape["set"] = (definition, values) =>
    Effect.gen(function* () {
      const startedAt = timingNow();
      const path = pathFor(definition);
      const current = yield* readFile(definition);
      const merged = mergeDeclaredScriptInputValues(
        definition,
        current.values,
        values,
      );
      const file: ScriptInputStorageFile = {
        version: SCRIPT_INPUT_STORAGE_VERSION,
        id: definition.id,
        values: merged,
        updatedAt: now().toISOString(),
      };

      yield* options.storage.writeJson(path, file);

      const durationMs = roundTimingMs(timingNow() - startedAt);
      yield* observeTiming(options.observability, "write", {
        id: definition.id,
        path,
        durationMs,
        fieldCount: definition.fields.length,
      });

      return merged;
    });

  return {
    inputsDir: options.inputsDir,
    get,
    set,
  };
};

export const layer = Layer.effect(ScriptInputRepository)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const storage = yield* DesktopStorage;
    const observability = yield* DesktopObservability;
    return makeScriptInputRepository({
      inputsDir: env.appDataPath(SCRIPT_INPUTS_DIR),
      storage,
      observability,
    });
  }),
);
