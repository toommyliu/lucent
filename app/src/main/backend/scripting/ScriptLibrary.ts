import { promises as fs } from "fs";
import { basename, sep } from "path";
import { Data, Effect, Layer, ServiceMap } from "effect";
import type { ScriptExecutePayload } from "../../../shared/ipc";
import type { ScriptInputsDefinition } from "../../../shared/script-inputs";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../../app/DesktopObservability";
import { roundTimingMs, timingNow } from "../../timing";
import { extractScriptInputsDefinitionWithTimings } from "./ScriptInputsExtractor";

export class ScriptLibraryError extends Data.TaggedError("ScriptLibraryError")<{
  readonly operation: "resolve" | "read" | "refresh";
  readonly path: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Could not ${this.operation} script: ${this.path}`;
  }
}

export interface ScriptLibraryShape {
  readonly scriptsDir: string;
  readonly resolvePath: (
    path: string,
  ) => Effect.Effect<string, ScriptLibraryError>;
  readonly read: (
    path: string,
  ) => Effect.Effect<ScriptExecutePayload, ScriptLibraryError>;
  readonly refresh: (
    payload: ScriptExecutePayload,
  ) => Effect.Effect<ScriptExecutePayload, ScriptLibraryError>;
}

export class ScriptLibrary extends ServiceMap.Service<
  ScriptLibrary,
  ScriptLibraryShape
>()("main/backend/scripting/ScriptLibrary") {}

export const resolveScriptPath = async (
  scriptsPath: string,
  path: string,
): Promise<string> => {
  await fs.mkdir(scriptsPath, { recursive: true });

  const [scriptsRoot, scriptPath] = await Promise.all([
    fs.realpath(scriptsPath),
    fs.realpath(path),
  ]);

  if (
    scriptPath !== scriptsRoot &&
    !scriptPath.startsWith(`${scriptsRoot}${sep}`)
  ) {
    throw new Error("Script path must be inside the scripts directory");
  }

  return scriptPath;
};

interface ScriptPayloadReadTimings {
  readonly resolveMs: number;
  readonly readMs: number;
  readonly parseMs: number;
  readonly validationMs: number;
  readonly totalMs: number;
  readonly sourceBytes: number;
  readonly declarationFound: boolean;
}

interface ScriptPayloadReadResult {
  readonly payload: ScriptExecutePayload;
  readonly timings: ScriptPayloadReadTimings;
}

const sourceByteLength = (source: string): number =>
  Buffer.byteLength(source, "utf8");

const readScriptPayloadWithTimings = async (
  scriptsPath: string,
  path: string,
): Promise<ScriptPayloadReadResult> => {
  const totalStartedAt = timingNow();
  const resolveStartedAt = timingNow();
  const scriptPath = await resolveScriptPath(scriptsPath, path);
  const resolveMs = roundTimingMs(timingNow() - resolveStartedAt);
  const readStartedAt = timingNow();
  const source = await fs.readFile(scriptPath, "utf8");
  const readMs = roundTimingMs(timingNow() - readStartedAt);
  const name = basename(scriptPath);
  const extraction = extractScriptInputsDefinitionWithTimings(source, name);
  const inputs = extraction.definition;
  const payload: ScriptExecutePayload = {
    source,
    path: scriptPath,
    name,
    ...(inputs === undefined ? {} : { inputs }),
  };

  return {
    payload,
    timings: {
      resolveMs,
      readMs,
      parseMs: extraction.timings.parseMs,
      validationMs: extraction.timings.validationMs,
      totalMs: roundTimingMs(timingNow() - totalStartedAt),
      sourceBytes: sourceByteLength(source),
      declarationFound: extraction.timings.declarationFound,
    },
  };
};

export const readScriptPayload = async (
  scriptsPath: string,
  path: string,
): Promise<ScriptExecutePayload> =>
  (await readScriptPayloadWithTimings(scriptsPath, path)).payload;

export const refreshScriptPayload = async (
  scriptsPath: string,
  payload: ScriptExecutePayload,
): Promise<ScriptExecutePayload> => {
  const path = payload.path?.trim();
  if (!path) {
    return payload;
  }

  return await readScriptPayload(scriptsPath, path);
};

const observeReadTimings = (
  observability: Pick<DesktopObservabilityShape, "debug" | "warn">,
  input: {
    readonly operation: "read" | "refresh";
    readonly path: string;
    readonly name?: string;
    readonly inputs?: ScriptInputsDefinition;
    readonly timings: ScriptPayloadReadTimings;
  },
): Effect.Effect<void> => {
  const base = {
    operation: input.operation,
    path: input.path,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.inputs === undefined ? {} : { inputId: input.inputs.id }),
    fieldCount: input.inputs?.fields.length ?? 0,
    sourceBytes: input.timings.sourceBytes,
  };

  const observeStage = (
    stage: string,
    durationMs: number,
    level: "debug" | "warn" = "debug",
  ) =>
    observability[level](
      "scripting",
      level === "warn"
        ? `Script ${stage} was slow`
        : `Script ${stage} completed`,
      {
        ...base,
        stage,
        durationMs,
      },
    ).pipe(Effect.asVoid);

  return Effect.gen(function* () {
    yield* observeStage("path resolve", input.timings.resolveMs);
    yield* observeStage("source read", input.timings.readMs);
    yield* observeStage(
      "metadata parse",
      input.timings.parseMs,
      input.timings.parseMs > 50 ? "warn" : "debug",
    );
    if (input.timings.declarationFound) {
      yield* observeStage("input validation", input.timings.validationMs);
    }
    yield* observability[input.timings.totalMs > 250 ? "warn" : "debug"](
      "scripting",
      input.timings.totalMs > 250
        ? "Script load was slow"
        : "Script load completed",
      {
        ...base,
        stage: "total load",
        durationMs: input.timings.totalMs,
        declarationFound: input.timings.declarationFound,
        resolveMs: input.timings.resolveMs,
        readMs: input.timings.readMs,
        parseMs: input.timings.parseMs,
        validationMs: input.timings.validationMs,
      },
    );
  }).pipe(Effect.asVoid);
};

const failureReason = (error: unknown): string =>
  error instanceof ScriptLibraryError
    ? error.cause instanceof Error && error.cause.message !== ""
      ? error.cause.message
      : "Script library operation failed"
    : error instanceof Error && error.message !== ""
      ? error.message
      : "Script library operation failed";

const observeReadFailure = (
  observability: Pick<DesktopObservabilityShape, "warn">,
  input: {
    readonly operation: "read" | "refresh";
    readonly path: string;
    readonly durationMs: number;
    readonly error: unknown;
  },
): Effect.Effect<void> =>
  observability
    .warn("scripting", "Script load failed", {
      operation: input.operation,
      path: input.path,
      stage: "total load",
      durationMs: input.durationMs,
      failureReason: failureReason(input.error),
    })
    .pipe(Effect.asVoid);

const readScriptPayloadResult = (
  scriptsDir: string,
  path: string,
  operation: "read" | "refresh",
  observability: Pick<DesktopObservabilityShape, "warn">,
  errorPath: string = path,
): Effect.Effect<ScriptPayloadReadResult, ScriptLibraryError> =>
  Effect.gen(function* () {
    const startedAt = timingNow();
    return yield* Effect.tryPromise({
      try: () => readScriptPayloadWithTimings(scriptsDir, path),
      catch: (cause) =>
        new ScriptLibraryError({ operation, path: errorPath, cause }),
    }).pipe(
      Effect.catch((error: ScriptLibraryError) =>
        Effect.gen(function* () {
          yield* observeReadFailure(observability, {
            operation,
            path: errorPath,
            durationMs: roundTimingMs(timingNow() - startedAt),
            error,
          });
          return yield* error;
        }),
      ),
    );
  });

export const makeScriptLibrary = (
  scriptsDir: string,
  observability: Pick<DesktopObservabilityShape, "debug" | "warn">,
): ScriptLibraryShape => {
  const resolvePath: ScriptLibraryShape["resolvePath"] = (path) =>
    Effect.tryPromise({
      try: () => resolveScriptPath(scriptsDir, path),
      catch: (cause) =>
        new ScriptLibraryError({ operation: "resolve", path, cause }),
    });

  const read: ScriptLibraryShape["read"] = (path) =>
    Effect.gen(function* () {
      const result = yield* readScriptPayloadResult(
        scriptsDir,
        path,
        "read",
        observability,
      );
      yield* observeReadTimings(observability, {
        operation: "read",
        path: result.payload.path ?? path,
        ...(result.payload.name === undefined
          ? {}
          : { name: result.payload.name }),
        ...(result.payload.inputs === undefined
          ? {}
          : { inputs: result.payload.inputs }),
        timings: result.timings,
      });
      return result.payload;
    });

  const refresh: ScriptLibraryShape["refresh"] = (payload) =>
    Effect.gen(function* () {
      const path = payload.path?.trim();
      if (!path) {
        return payload;
      }

      const errorPath = payload.path ?? payload.name ?? "<inline script>";
      const result = yield* readScriptPayloadResult(
        scriptsDir,
        path,
        "refresh",
        observability,
        errorPath,
      );
      yield* observeReadTimings(observability, {
        operation: "refresh",
        path: result.payload.path ?? path,
        ...(result.payload.name === undefined
          ? {}
          : { name: result.payload.name }),
        ...(result.payload.inputs === undefined
          ? {}
          : { inputs: result.payload.inputs }),
        timings: result.timings,
      });
      return result.payload;
    });

  return {
    scriptsDir,
    resolvePath,
    read,
    refresh,
  };
};

export const layer = Layer.effect(ScriptLibrary)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const observability = yield* DesktopObservability;
    return makeScriptLibrary(env.scriptsDir, observability);
  }),
);
