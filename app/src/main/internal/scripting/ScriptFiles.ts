/* oxlint-disable unicorn/require-post-message-target-origin */
import { join, resolve as resolvePath } from "path";
import { Worker } from "worker_threads";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type {
  ScriptFile,
  ScriptFileResolution,
} from "@lucent/core/scriptInputs";
import {
  SCRIPT_FILE_WORKER_HEAP_MB,
  SCRIPT_FILE_WORKER_QUEUE_LIMIT,
  SCRIPT_FILE_WORKER_TIMEOUT_MS,
  type ScriptFileAnalysis,
  type ScriptFileAnalysisResolution,
  type ScriptFileWorkerRequest,
  type ScriptFileWorkerResponse,
} from "./ScriptFileWorkerProtocol";

export class ScriptFilesError extends Schema.TaggedErrorClass<ScriptFilesError>()(
  "ScriptFilesError",
  {
    path: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ScriptFilesShape {
  readonly analyze: (
    path: string,
  ) => Effect.Effect<ScriptFileAnalysis, ScriptFilesError>;
  readonly read: (path: string) => Effect.Effect<ScriptFile, ScriptFilesError>;
  readonly resolve: (path: string) => Effect.Effect<ScriptFileResolution>;
}

export class ScriptFiles extends Context.Service<
  ScriptFiles,
  ScriptFilesShape
>()("lucent/internal/scripting/ScriptFiles") {}

interface QueuedRequest {
  readonly id: number;
  readonly path: string;
  readonly reject: (error: Error) => void;
  readonly resolve: (resolution: ScriptFileAnalysisResolution) => void;
}

export class ScriptFileWorkerClient {
  readonly #queue: QueuedRequest[] = [];
  readonly #workerFactory: () => Worker;
  #active: QueuedRequest | null = null;
  #closed = false;
  #nextId = 0;
  #timeout: NodeJS.Timeout | undefined;
  #worker: Worker | null = null;

  constructor(
    workerFactory: () => Worker = () =>
      new Worker(join(__dirname, "script-file-worker.js"), {
        resourceLimits: {
          maxOldGenerationSizeMb: SCRIPT_FILE_WORKER_HEAP_MB,
        },
      }),
  ) {
    this.#workerFactory = workerFactory;
  }

  resolve(path: string): Promise<ScriptFileAnalysisResolution> {
    if (this.#closed) {
      return Promise.reject(new Error("Script file worker is closed."));
    }
    if (
      this.#queue.length + (this.#active === null ? 0 : 1) >=
      SCRIPT_FILE_WORKER_QUEUE_LIMIT
    ) {
      return Promise.reject(new Error("Script file worker queue is full."));
    }

    return new Promise((resolve, reject) => {
      this.#queue.push({
        id: (this.#nextId += 1),
        path,
        reject,
        resolve,
      });
      this.#pump();
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#clearTimeout();
    this.#rejectAllRequests(new Error("Script file worker is shutting down."));
    const worker = this.#worker;
    this.#worker = null;
    if (worker !== null) {
      worker.removeAllListeners();
      await worker.terminate();
    }
  }

  #ensureWorker(): Worker {
    if (this.#worker !== null) return this.#worker;

    const worker = this.#workerFactory();
    worker.unref();
    worker.on("message", (response: ScriptFileWorkerResponse) => {
      const active = this.#active;
      if (active === null || response.id !== active.id) return;
      this.#clearTimeout();
      this.#active = null;
      active.resolve(response.resolution);
      this.#pump();
    });
    worker.on("error", (error) => this.#resetWorker(error));
    worker.on("exit", (code) => {
      if (this.#worker === worker) {
        this.#resetWorker(
          new Error(`Script file worker exited with code ${code}.`),
        );
      }
    });
    this.#worker = worker;
    return worker;
  }

  #pump(): void {
    if (this.#closed || this.#active !== null) return;
    const next = this.#queue.shift();
    if (next === undefined) return;

    this.#active = next;
    try {
      const worker = this.#ensureWorker();
      worker.postMessage({
        id: next.id,
        path: next.path,
      } satisfies ScriptFileWorkerRequest);
      this.#timeout = setTimeout(() => {
        this.#resetWorker(
          new Error(
            `Script file processing timed out after ${SCRIPT_FILE_WORKER_TIMEOUT_MS} ms.`,
          ),
        );
      }, SCRIPT_FILE_WORKER_TIMEOUT_MS);
      this.#timeout.unref();
    } catch (error) {
      this.#resetWorker(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  #clearTimeout(): void {
    if (this.#timeout === undefined) return;
    clearTimeout(this.#timeout);
    this.#timeout = undefined;
  }

  #rejectActiveRequest(error: Error): void {
    const active = this.#active;
    this.#active = null;
    active?.reject(error);
  }

  #rejectAllRequests(error: Error): void {
    this.#rejectActiveRequest(error);
    for (const queued of this.#queue.splice(0)) queued.reject(error);
  }

  #resetWorker(error: Error): void {
    this.#clearTimeout();
    const worker = this.#worker;
    this.#worker = null;
    if (worker !== null) {
      worker.removeAllListeners();
      void worker.terminate();
    }
    this.#rejectActiveRequest(error);
    this.#pump();
  }
}

const failureResolution = (
  path: string,
  error: unknown,
): ScriptFileAnalysisResolution => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    status: "failed",
    path,
    message: normalized.message || "Script file processing failed.",
    ...(normalized.stack === undefined
      ? {}
      : { detailsText: normalized.stack }),
  };
};

export const makeScriptFiles = (
  processFile: (path: string) => Promise<ScriptFileAnalysisResolution>,
): ScriptFilesShape => {
  const resolveFile = makeScriptFileResolver(processFile);

  const resolve: ScriptFilesShape["resolve"] = (path) =>
    Effect.promise(() => resolveFile(path)).pipe(
      Effect.map(
        (resolution): ScriptFileResolution =>
          resolution.status === "found"
            ? { status: "found", file: resolution.analysis.file }
            : resolution,
      ),
    );

  const analyze: ScriptFilesShape["analyze"] = (path) =>
    Effect.promise(() => resolveFile(path)).pipe(
      Effect.flatMap((resolution) => {
        switch (resolution.status) {
          case "found":
            return Effect.succeed(resolution.analysis);
          case "missing":
            return Effect.fail(
              new ScriptFilesError({
                path: resolution.path,
                detail: `Script file was not found at ${resolution.path}.`,
              }),
            );
          case "failed":
            return Effect.fail(
              new ScriptFilesError({
                path: resolution.path,
                detail: resolution.message,
                ...(resolution.detailsText === undefined
                  ? {}
                  : { cause: new Error(resolution.detailsText) }),
              }),
            );
        }
      }),
    );

  const read: ScriptFilesShape["read"] = (path) =>
    analyze(path).pipe(Effect.map((analysis) => analysis.file));

  return ScriptFiles.of({ analyze, read, resolve });
};

export const makeScriptFileResolver = (
  processFile: (path: string) => Promise<ScriptFileAnalysisResolution>,
): ((path: string) => Promise<ScriptFileAnalysisResolution>) => {
  const inFlight = new Map<string, Promise<ScriptFileAnalysisResolution>>();

  return (path) => {
    const normalizedPath = resolvePath(path);
    const pending = inFlight.get(normalizedPath);
    if (pending !== undefined) return pending;

    const created = processFile(normalizedPath)
      .catch((error: unknown) => failureResolution(normalizedPath, error))
      .finally(() => {
        if (inFlight.get(normalizedPath) === created) {
          inFlight.delete(normalizedPath);
        }
      });
    inFlight.set(normalizedPath, created);
    return created;
  };
};

export const layer = Layer.effect(
  ScriptFiles,
  Effect.gen(function* () {
    const client = new ScriptFileWorkerClient();
    yield* Effect.addFinalizer(() => Effect.promise(() => client.close()));
    return makeScriptFiles((path) => client.resolve(path));
  }),
);
