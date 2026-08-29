import { cpus, totalmem } from "os";
import { basename, join } from "path";

import type { TraceConfig } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ElectronApp } from "../../electron/ElectronApp";
import {
  ElectronChromiumPerformance,
  type ElectronChromiumRendererTarget,
  type ElectronMainHeapUsage,
} from "../../electron/ElectronChromiumPerformance";
import { DesktopWindows } from "../../window/DesktopWindows";
import type { DesktopWindowKind } from "../../window/DesktopWindowCatalog";
import {
  CHROMIUM_PERFORMANCE_RECORDING_SCHEMA_VERSION,
  CHROMIUM_PERFORMANCE_TRACE_CATEGORIES,
  CHROMIUM_PERFORMANCE_TRACE_EXCLUDED_CATEGORIES,
  CHROMIUM_RENDERER_HEAP_SAMPLE_INTERVAL_MS,
  CHROMIUM_RENDERER_HEAP_SAMPLE_TIMEOUT_MS,
  CHROMIUM_RESOURCE_SAMPLE_INTERVAL_MS,
  CHROMIUM_TRACE_BUFFER_SIZE_KIB,
  CHROMIUM_TRACE_SEGMENT_CHECK_INTERVAL_MS,
  CHROMIUM_TRACE_SEGMENT_MAX_DURATION_MS,
  chromiumHeapCheckpointDirectoryName,
  chromiumRecordingTimestamp,
  chromiumTraceRotationReason,
  chromiumTraceSegmentFileName,
  type ChromiumTraceRotationReason,
} from "./ChromiumPerformanceRecordingModel";
import { DesktopEnvironment } from "../DesktopEnvironment";
import { DesktopFileSystem } from "../../filesystem/DesktopFileSystem";
import { makeListenerRegistry } from "../ListenerRegistry";
import { DesktopObservability } from "./DesktopObservability";
import {
  normalizePerformanceTraceMetric,
  type PerformanceTraceProcessSample,
} from "./DesktopPerformanceTrace";

const PERFORMANCE_RECORDINGS_DIRECTORY_NAME = "chromium-performance-recordings";
const MANIFEST_FILE_NAME = "manifest.json";
const RESOURCES_FILE_NAME = "resources.json";
const HEAP_SNAPSHOTS_DIRECTORY_NAME = "heap-snapshots";
const MAX_RECORDED_WARNING_COUNT = 100;

export type DesktopChromiumPerformanceRecordingState =
  | { readonly status: "idle" }
  | { readonly startedAt: string; readonly status: "recording" }
  | { readonly startedAt: string; readonly status: "snapshotting" }
  | { readonly startedAt: string; readonly status: "saving" };

export interface DesktopChromiumHeapSnapshotResult {
  readonly checkpointPath: string;
  readonly failedSnapshotCount: number;
  readonly snapshotCount: number;
}

export interface DesktopChromiumPerformanceRecordingResult {
  readonly durationMs: number;
  readonly heapCheckpointCount: number;
  readonly manifestPath: string;
  readonly resourceSampleCount: number;
  readonly sessionPath: string;
  readonly traceSegmentCount: number;
  readonly warningCount: number;
}

export class DesktopChromiumPerformanceRecordingBusyError extends Schema.TaggedErrorClass<DesktopChromiumPerformanceRecordingBusyError>()(
  "DesktopChromiumPerformanceRecordingBusyError",
  {
    status: Schema.String,
  },
) {
  override get message(): string {
    return `A Chromium performance recording is already ${this.status}.`;
  }
}

export class DesktopChromiumPerformanceRecordingNotActiveError extends Schema.TaggedErrorClass<DesktopChromiumPerformanceRecordingNotActiveError>()(
  "DesktopChromiumPerformanceRecordingNotActiveError",
  {},
) {
  override get message(): string {
    return "No Chromium performance recording is active.";
  }
}

export class DesktopChromiumPerformanceRecordingStartError extends Schema.TaggedErrorClass<DesktopChromiumPerformanceRecordingStartError>()(
  "DesktopChromiumPerformanceRecordingStartError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to start the Chromium performance recording.";
  }
}

export class DesktopChromiumPerformanceRecordingSaveError extends Schema.TaggedErrorClass<DesktopChromiumPerformanceRecordingSaveError>()(
  "DesktopChromiumPerformanceRecordingSaveError",
  {
    cause: Schema.Defect(),
    sessionPath: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to save the Chromium performance recording to ${this.sessionPath}.`;
  }
}

export class DesktopChromiumHeapSnapshotError extends Schema.TaggedErrorClass<DesktopChromiumHeapSnapshotError>()(
  "DesktopChromiumHeapSnapshotError",
  {
    cause: Schema.Defect(),
    checkpointPath: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to save the Chromium heap checkpoint to ${this.checkpointPath}.`;
  }
}

export interface DesktopChromiumPerformanceRecordingShape {
  readonly captureHeapSnapshot: Effect.Effect<
    DesktopChromiumHeapSnapshotResult,
    | DesktopChromiumHeapSnapshotError
    | DesktopChromiumPerformanceRecordingBusyError
    | DesktopChromiumPerformanceRecordingNotActiveError
  >;
  readonly getState: Effect.Effect<DesktopChromiumPerformanceRecordingState>;
  readonly onChanged: (
    listener: (state: DesktopChromiumPerformanceRecordingState) => void,
  ) => Effect.Effect<() => void>;
  readonly start: Effect.Effect<
    void,
    | DesktopChromiumPerformanceRecordingBusyError
    | DesktopChromiumPerformanceRecordingStartError
  >;
  readonly stop: Effect.Effect<
    DesktopChromiumPerformanceRecordingResult | undefined,
    DesktopChromiumPerformanceRecordingSaveError
  >;
}

export class DesktopChromiumPerformanceRecording extends Context.Service<
  DesktopChromiumPerformanceRecording,
  DesktopChromiumPerformanceRecordingShape
>()("lucent/desktop/app/observability/DesktopChromiumPerformanceRecording") {}

interface ChromiumPerformanceMetadata {
  readonly appVersion: string;
  readonly architecture: string;
  readonly cpuModel: string | null;
  readonly isDev: boolean;
  readonly logicalCpuCount: number;
  readonly platform: NodeJS.Platform;
  readonly runtimeVersions: {
    readonly chrome: string;
    readonly electron: string;
    readonly node: string;
  };
  readonly totalSystemMemoryBytes: number;
}

interface ChromiumResourceSample {
  readonly capturedAt: string;
  readonly elapsedMs: number;
  readonly mainV8Heap: ElectronMainHeapUsage;
  readonly processes: readonly PerformanceTraceProcessSample[];
}

interface ChromiumRendererTargetMetadata {
  readonly rendererId: number;
  readonly generation: number;
  readonly kind: DesktopWindowKind;
  readonly osProcessId: number;
  readonly ownerRendererId: number | null;
}

interface ChromiumRendererHeapSample extends ChromiumRendererTargetMetadata {
  readonly capturedAt: string;
  readonly elapsedMs: number;
  readonly totalSizeBytes?: number;
  readonly usedSizeBytes?: number;
}

interface ChromiumTraceSegment {
  readonly durationMs: number;
  readonly endedAt: string;
  readonly fileName: string;
  readonly index: number;
  readonly reason: ChromiumTraceRotationReason | "stop";
  readonly startedAt: string;
}

interface ChromiumHeapSnapshotArtifact {
  readonly rendererId?: number;
  readonly error?: string;
  readonly fileName: string;
  readonly generation?: number;
  readonly kind: "main" | "renderer";
  readonly osProcessId: number;
  readonly status: "failed" | "saved";
  readonly windowKind?: DesktopWindowKind;
}

interface ChromiumHeapCheckpoint {
  readonly directoryName: string;
  readonly endedAt: string;
  readonly index: number;
  readonly snapshots: readonly ChromiumHeapSnapshotArtifact[];
  readonly startedAt: string;
}

interface ChromiumPerformanceResourcesDocument {
  readonly mainResourceSampleIntervalMs: number;
  readonly rendererHeapSampleIntervalMs: number;
  readonly rendererHeapSamples: readonly ChromiumRendererHeapSample[];
  readonly resourceSamples: readonly ChromiumResourceSample[];
  readonly schemaVersion: number;
}

interface ChromiumPerformanceManifest {
  readonly availableCategoriesAtStart: readonly string[];
  readonly currentTraceSegment?: {
    readonly startedAt: string;
  };
  readonly durationMs?: number;
  readonly endedAt?: string;
  readonly heapCheckpoints: readonly ChromiumHeapCheckpoint[];
  readonly metadata: ChromiumPerformanceMetadata;
  readonly resourceSampleCount: number;
  readonly rendererHeapSampleCount: number;
  readonly resourcesFileName: string;
  readonly schemaVersion: number;
  readonly startedAt: string;
  readonly status: "complete" | "recording";
  readonly trace: {
    readonly bufferSizeKiB: number;
    readonly categories: readonly string[];
    readonly excludedCategories: readonly string[];
    readonly recordingMode: "record-until-full";
    readonly segmentMaxDurationMs: number;
    readonly segments: readonly ChromiumTraceSegment[];
  };
  readonly warnings: readonly string[];
}

interface ActiveChromiumPerformanceRecording {
  readonly availableCategoriesAtStart: readonly string[];
  readonly heapCheckpoints: ChromiumHeapCheckpoint[];
  rendererHeapSamplePromise: Promise<void> | null;
  readonly rendererHeapSamples: ChromiumRendererHeapSample[];
  readonly resourceSamples: ChromiumResourceSample[];
  readonly sessionPath: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly traceConfig: TraceConfig;
  traceActive: boolean;
  segmentStartedAt: string;
  segmentStartedAtMs: number;
  readonly segments: ChromiumTraceSegment[];
  timers: ChromiumPerformanceRecordingTimers | null;
  readonly metadata: ChromiumPerformanceMetadata;
  readonly warnedKeys: Set<string>;
  readonly warnings: string[];
}

interface ChromiumPerformanceRecordingTimers {
  readonly rendererHeap: NodeJS.Timeout;
  readonly resources: NodeJS.Timeout;
  readonly segment: NodeJS.Timeout;
}

class ChromiumPerformanceArtifactError extends Schema.TaggedErrorClass<ChromiumPerformanceArtifactError>()(
  "ChromiumPerformanceArtifactError",
  {
    cause: Schema.Defect(),
    filePath: Schema.String,
  },
) {}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : String(cause);

const writeJsonArtifact = (
  filesystem: DesktopFileSystem["Service"],
  filePath: string,
  value: unknown,
): Effect.Effect<void, ChromiumPerformanceArtifactError> =>
  filesystem
    .writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
    .pipe(
      Effect.flatMap(() => filesystem.rename(`${filePath}.tmp`, filePath)),
      Effect.mapError(
        (cause) => new ChromiumPerformanceArtifactError({ cause, filePath }),
      ),
    );

const createRecordingDirectory = (
  filesystem: DesktopFileSystem["Service"],
  rootPath: string,
  sessionPath: string,
): Effect.Effect<void, ChromiumPerformanceArtifactError> =>
  filesystem.makeDirectory(rootPath, { recursive: true }).pipe(
    Effect.flatMap(() => filesystem.makeDirectory(sessionPath)),
    Effect.mapError(
      (cause) =>
        new ChromiumPerformanceArtifactError({ cause, filePath: sessionPath }),
    ),
  );

const createDirectory = (
  filesystem: DesktopFileSystem["Service"],
  path: string,
): Effect.Effect<void, ChromiumPerformanceArtifactError> =>
  filesystem
    .makeDirectory(path, { recursive: true })
    .pipe(
      Effect.mapError(
        (cause) =>
          new ChromiumPerformanceArtifactError({ cause, filePath: path }),
      ),
    );

const sessionDirectoryName = (startedAt: string): string =>
  `lucent-chromium-recording-${chromiumRecordingTimestamp(startedAt)}-${process.pid}`;

const isDefined = <Value>(value: Value | undefined): value is Value =>
  value !== undefined;

/** Stops all periodic work owned by an active recording. */
const clearRecordingTimers = (
  current: ActiveChromiumPerformanceRecording,
): void => {
  if (current.timers === null) {
    return;
  }
  clearInterval(current.timers.rendererHeap);
  clearInterval(current.timers.resources);
  clearInterval(current.timers.segment);
  current.timers = null;
};

const makeDesktopChromiumPerformanceRecording = Effect.gen(function* () {
  const chromium = yield* ElectronChromiumPerformance;
  const electronApp = yield* ElectronApp;
  const env = yield* DesktopEnvironment;
  const filesystem = yield* DesktopFileSystem;
  const observability = yield* DesktopObservability;
  const windows = yield* DesktopWindows;
  const operationGate = yield* Semaphore.make(1);
  const stateChanges =
    makeListenerRegistry<DesktopChromiumPerformanceRecordingState>();
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const runSync = Effect.runSyncWith(context);
  const recordingsRoot = join(
    env.appDataDir,
    PERFORMANCE_RECORDINGS_DIRECTORY_NAME,
  );
  let state: DesktopChromiumPerformanceRecordingState = { status: "idle" };
  let activeRecording: ActiveChromiumPerformanceRecording | undefined;

  const setState = Effect.fn("DesktopChromiumPerformanceRecording.setState")(
    function* (nextState: DesktopChromiumPerformanceRecordingState) {
      state = nextState;
      yield* stateChanges.publish(nextState);
    },
  );

  const buildManifest = (
    current: ActiveChromiumPerformanceRecording,
    status: ChromiumPerformanceManifest["status"],
    endedAt?: string,
  ): ChromiumPerformanceManifest => ({
    availableCategoriesAtStart: current.availableCategoriesAtStart,
    ...(status === "recording" && current.traceActive
      ? { currentTraceSegment: { startedAt: current.segmentStartedAt } }
      : {}),
    ...(endedAt === undefined
      ? {}
      : {
          durationMs: Math.max(
            0,
            new Date(endedAt).getTime() - current.startedAtMs,
          ),
          endedAt,
        }),
    heapCheckpoints: current.heapCheckpoints,
    metadata: current.metadata,
    rendererHeapSampleCount: current.rendererHeapSamples.length,
    resourceSampleCount: current.resourceSamples.length,
    resourcesFileName: RESOURCES_FILE_NAME,
    schemaVersion: CHROMIUM_PERFORMANCE_RECORDING_SCHEMA_VERSION,
    startedAt: current.startedAt,
    status,
    trace: {
      bufferSizeKiB: CHROMIUM_TRACE_BUFFER_SIZE_KIB,
      categories: CHROMIUM_PERFORMANCE_TRACE_CATEGORIES,
      excludedCategories: CHROMIUM_PERFORMANCE_TRACE_EXCLUDED_CATEGORIES,
      recordingMode: "record-until-full",
      segmentMaxDurationMs: CHROMIUM_TRACE_SEGMENT_MAX_DURATION_MS,
      segments: current.segments,
    },
    warnings: current.warnings,
  });

  const writeManifest = (
    current: ActiveChromiumPerformanceRecording,
    status: ChromiumPerformanceManifest["status"],
    endedAt?: string,
  ) =>
    writeJsonArtifact(
      filesystem,
      join(current.sessionPath, MANIFEST_FILE_NAME),
      buildManifest(current, status, endedAt),
    );

  const recordWarning = Effect.fn(
    "DesktopChromiumPerformanceRecording.recordWarning",
  )(function* (
    current: ActiveChromiumPerformanceRecording,
    key: string,
    message: string,
    cause?: unknown,
  ) {
    if (current.warnedKeys.has(key)) {
      return;
    }

    current.warnedKeys.add(key);
    if (current.warnings.length < MAX_RECORDED_WARNING_COUNT) {
      current.warnings.push(
        cause === undefined ? message : `${message}: ${errorMessage(cause)}`,
      );
    }
    yield* observability.warn(
      "chromium-performance-recording",
      message,
      cause === undefined ? undefined : { cause },
    );
  });

  const resolveRendererTarget = Effect.fn(
    "DesktopChromiumPerformanceRecording.resolveRendererTarget",
  )(function* (
    target: ElectronChromiumRendererTarget,
  ): Effect.fn.Return<ChromiumRendererTargetMetadata | undefined> {
    const kind = yield* windows
      .getRendererKind(target.rendererId)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (
      kind === null ||
      kind === "game-group-controls" ||
      kind === "game-host"
    ) {
      return undefined;
    }

    const generation = yield* windows
      .getRendererGeneration(target.rendererId)
      .pipe(Effect.catch(() => Effect.void));
    if (generation === undefined) {
      return undefined;
    }

    const ownerRendererId = yield* windows
      .getOwnerRendererId(target.rendererId)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    return {
      rendererId: target.rendererId,
      generation,
      kind,
      osProcessId: target.osProcessId,
      ownerRendererId,
    };
  });

  const captureResourceSample = (): void => {
    const current = activeRecording;
    if (
      current === undefined ||
      (state.status !== "recording" && state.status !== "snapshotting")
    ) {
      return;
    }

    try {
      const metrics = runSync(electronApp.getAppMetrics);
      const mainV8Heap = runSync(chromium.getMainHeapUsage);
      const capturedAtMs = Date.now();
      current.resourceSamples.push({
        capturedAt: new Date(capturedAtMs).toISOString(),
        elapsedMs: Math.max(0, capturedAtMs - current.startedAtMs),
        mainV8Heap,
        processes: metrics.map(normalizePerformanceTraceMetric),
      });
    } catch (cause) {
      void runPromise(
        recordWarning(
          current,
          "resource-sample",
          "Failed to capture a Chromium recording resource sample",
          cause,
        ),
      ).catch(() => undefined);
    }
  };

  const captureRendererHeapSample = Effect.fn(
    "DesktopChromiumPerformanceRecording.captureRendererHeapSample",
  )(function* (current: ActiveChromiumPerformanceRecording) {
    if (activeRecording !== current || state.status !== "recording") {
      return;
    }

    const targets = yield* chromium.getRendererTargets;
    const samples = yield* Effect.forEach(
      targets,
      (target) =>
        Effect.gen(function* () {
          const metadata = yield* resolveRendererTarget(target);
          if (metadata === undefined) {
            return undefined;
          }

          const usage = yield* chromium
            .getRendererHeapUsage(target.rendererId)
            .pipe(
              Effect.timeout(CHROMIUM_RENDERER_HEAP_SAMPLE_TIMEOUT_MS),
              Effect.catch((cause) =>
                recordWarning(
                  current,
                  `renderer-heap:${target.rendererId}:${metadata.generation}`,
                  `Renderer V8 heap usage is unavailable for ${metadata.kind} window ${target.rendererId}`,
                  cause,
                ).pipe(Effect.as(undefined)),
              ),
            );
          const capturedAtMs = Date.now();
          return {
            ...metadata,
            capturedAt: new Date(capturedAtMs).toISOString(),
            elapsedMs: Math.max(0, capturedAtMs - current.startedAtMs),
            ...(usage === undefined
              ? {}
              : {
                  totalSizeBytes: usage.totalSizeBytes,
                  usedSizeBytes: usage.usedSizeBytes,
                }),
          } satisfies ChromiumRendererHeapSample;
        }),
      { concurrency: "unbounded" },
    );

    if (activeRecording === current) {
      current.rendererHeapSamples.push(...samples.filter(isDefined));
    }
  });

  const startRendererHeapSample = (): void => {
    const current = activeRecording;
    if (
      current === undefined ||
      state.status !== "recording" ||
      current.rendererHeapSamplePromise !== null
    ) {
      return;
    }

    const samplePromise = runPromise(captureRendererHeapSample(current))
      .catch((cause) =>
        runPromise(
          recordWarning(
            current,
            "renderer-heap-sample",
            "Failed to capture renderer V8 heap usage",
            cause,
          ),
        ).catch(() => undefined),
      )
      .then(() => undefined)
      .finally(() => {
        if (current.rendererHeapSamplePromise === samplePromise) {
          current.rendererHeapSamplePromise = null;
        }
      });
    current.rendererHeapSamplePromise = samplePromise;
  };

  const closeTraceSegment = Effect.fn(
    "DesktopChromiumPerformanceRecording.closeTraceSegment",
  )(function* (
    current: ActiveChromiumPerformanceRecording,
    reason: ChromiumTraceSegment["reason"],
  ) {
    if (!current.traceActive) {
      return;
    }

    const endedAtMs = Date.now();
    const endedAt = new Date(endedAtMs).toISOString();
    const index = current.segments.length;
    const requestedFilePath = join(
      current.sessionPath,
      chromiumTraceSegmentFileName(index),
    );
    const actualFilePath = yield* chromium.stopRecording(requestedFilePath);
    current.traceActive = false;
    current.segments.push({
      durationMs: Math.max(0, endedAtMs - current.segmentStartedAtMs),
      endedAt,
      fileName: basename(actualFilePath),
      index,
      reason,
      startedAt: current.segmentStartedAt,
    });
  });

  const startTraceSegment = Effect.fn(
    "DesktopChromiumPerformanceRecording.startTraceSegment",
  )(function* (current: ActiveChromiumPerformanceRecording) {
    const segmentStartedAtMs = Date.now();
    const segmentStartedAt = new Date(segmentStartedAtMs).toISOString();
    yield* chromium.startRecording(current.traceConfig);
    current.segmentStartedAt = segmentStartedAt;
    current.segmentStartedAtMs = segmentStartedAtMs;
    current.traceActive = true;
  });

  const rotateTraceSegment = Effect.fn(
    "DesktopChromiumPerformanceRecording.rotateTraceSegment",
  )(function* (
    current: ActiveChromiumPerformanceRecording,
    reason: ChromiumTraceRotationReason,
  ) {
    yield* closeTraceSegment(current, reason);
    yield* startTraceSegment(current);
    yield* writeManifest(current, "recording").pipe(
      Effect.catch((cause) =>
        recordWarning(
          current,
          "manifest-update",
          "Failed to update the Chromium recording manifest",
          cause,
        ),
      ),
    );
  });

  const rotateExpiredTraceSegment = Effect.fn(
    "DesktopChromiumPerformanceRecording.rotateExpiredTraceSegment",
  )(function* () {
    const current = activeRecording;
    if (current === undefined || state.status !== "recording") {
      return;
    }

    if (!current.traceActive) {
      yield* startTraceSegment(current);
      return;
    }

    const durationMs = Math.max(0, Date.now() - current.segmentStartedAtMs);
    const reason = chromiumTraceRotationReason(durationMs);
    if (reason !== null) {
      yield* rotateTraceSegment(current, reason);
    }
  });

  const rotateExpiredTraceSegmentInBackground = (): void => {
    const current = activeRecording;
    if (current === undefined) {
      return;
    }

    void runPromise(
      operationGate
        .withPermitsIfAvailable(1)(rotateExpiredTraceSegment())
        .pipe(
          Effect.catch((cause) =>
            recordWarning(
              current,
              "trace-rotation",
              "Failed to rotate the Chromium trace segment",
              cause,
            ),
          ),
        ),
    ).catch(() => undefined);
  };

  const installTimers = (current: ActiveChromiumPerformanceRecording): void => {
    const resources = setInterval(
      captureResourceSample,
      CHROMIUM_RESOURCE_SAMPLE_INTERVAL_MS,
    );
    const rendererHeap = setInterval(
      startRendererHeapSample,
      CHROMIUM_RENDERER_HEAP_SAMPLE_INTERVAL_MS,
    );
    const segment = setInterval(
      rotateExpiredTraceSegmentInBackground,
      CHROMIUM_TRACE_SEGMENT_CHECK_INTERVAL_MS,
    );
    resources.unref?.();
    rendererHeap.unref?.();
    segment.unref?.();
    current.timers = { rendererHeap, resources, segment };
  };

  const initializeRecording = Effect.gen(function* () {
    yield* electronApp.getAppMetrics;
    const appVersion = yield* electronApp.getVersion;
    const availableCategoriesAtStart = yield* chromium.getCategories;
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const sessionPath = join(recordingsRoot, sessionDirectoryName(startedAt));
    yield* createRecordingDirectory(filesystem, recordingsRoot, sessionPath);

    const cpuList = cpus();
    const traceConfig: TraceConfig = {
      excluded_categories: [...CHROMIUM_PERFORMANCE_TRACE_EXCLUDED_CATEGORIES],
      included_categories: [...CHROMIUM_PERFORMANCE_TRACE_CATEGORIES],
      recording_mode: "record-until-full",
      trace_buffer_size_in_kb: CHROMIUM_TRACE_BUFFER_SIZE_KIB,
    };
    const current: ActiveChromiumPerformanceRecording = {
      availableCategoriesAtStart,
      heapCheckpoints: [],
      metadata: {
        appVersion,
        architecture: process.arch,
        cpuModel: cpuList[0]?.model ?? null,
        isDev: env.isDev,
        logicalCpuCount: cpuList.length,
        platform: env.platform,
        runtimeVersions: {
          chrome: process.versions.chrome ?? "unknown",
          electron: process.versions.electron ?? "unknown",
          node: process.versions.node,
        },
        totalSystemMemoryBytes: totalmem(),
      },
      rendererHeapSamplePromise: null,
      rendererHeapSamples: [],
      resourceSamples: [],
      segments: [],
      segmentStartedAt: startedAt,
      segmentStartedAtMs: startedAtMs,
      sessionPath,
      startedAt,
      startedAtMs,
      timers: null,
      traceActive: false,
      traceConfig,
      warnedKeys: new Set(),
      warnings: [],
    };
    activeRecording = current;

    yield* chromium.startRecording(traceConfig);
    current.traceActive = true;
    yield* writeManifest(current, "recording");
    yield* setState({ startedAt, status: "recording" });
    installTimers(current);
    captureResourceSample();
    startRendererHeapSample();
    yield* observability.info(
      "chromium-performance-recording",
      "Chromium performance recording started",
      {
        bufferSizeKiB: CHROMIUM_TRACE_BUFFER_SIZE_KIB,
        categoryCount: CHROMIUM_PERFORMANCE_TRACE_CATEGORIES.length,
        sessionPath,
        startedAt,
      },
    );
  }).pipe(
    Effect.mapError(
      (cause) => new DesktopChromiumPerformanceRecordingStartError({ cause }),
    ),
    Effect.catch((error) => {
      const current = activeRecording;
      if (current !== undefined) {
        clearRecordingTimers(current);
      }
      const stopTrace =
        current !== undefined && current.traceActive
          ? chromium
              .stopRecording(
                join(current.sessionPath, chromiumTraceSegmentFileName(0)),
              )
              .pipe(Effect.catch(() => Effect.void))
          : Effect.void;
      return stopTrace.pipe(
        Effect.andThen(chromium.releaseRendererDebuggers),
        Effect.tap(() =>
          Effect.sync(() => {
            activeRecording = undefined;
          }),
        ),
        Effect.andThen(setState({ status: "idle" })),
        Effect.andThen(Effect.fail(error)),
      );
    }),
  );

  const startInternal = Effect.gen(function* () {
    if (state.status !== "idle") {
      return yield* new DesktopChromiumPerformanceRecordingBusyError({
        status: state.status,
      });
    }
    yield* initializeRecording;
  });

  const start: DesktopChromiumPerformanceRecordingShape["start"] =
    operationGate.withPermits(1)(startInternal);

  const snapshotArtifact = <Error>(input: {
    readonly effect: Effect.Effect<void, Error>;
    readonly failed: Omit<ChromiumHeapSnapshotArtifact, "error" | "status">;
  }): Effect.Effect<ChromiumHeapSnapshotArtifact> =>
    input.effect.pipe(
      Effect.as({ ...input.failed, status: "saved" as const }),
      Effect.catch((cause) =>
        Effect.succeed({
          ...input.failed,
          error: errorMessage(cause),
          status: "failed" as const,
        }),
      ),
    );

  const captureHeapSnapshotInternal = Effect.gen(function* () {
    if (state.status === "idle" || activeRecording === undefined) {
      return yield* new DesktopChromiumPerformanceRecordingNotActiveError();
    }
    if (state.status !== "recording") {
      return yield* new DesktopChromiumPerformanceRecordingBusyError({
        status: state.status,
      });
    }

    const current = activeRecording;
    yield* setState({ startedAt: current.startedAt, status: "snapshotting" });
    const pendingRendererHeapSample = current.rendererHeapSamplePromise;
    if (pendingRendererHeapSample !== null) {
      yield* Effect.promise(() => pendingRendererHeapSample);
    }

    const checkpointStartedAt = new Date().toISOString();
    const checkpointIndex = current.heapCheckpoints.length;
    const directoryName = chromiumHeapCheckpointDirectoryName(
      checkpointIndex,
      checkpointStartedAt,
    );
    const checkpointPath = join(
      current.sessionPath,
      HEAP_SNAPSHOTS_DIRECTORY_NAME,
      directoryName,
    );
    yield* createDirectory(filesystem, checkpointPath);

    const mainFileName = "main.heapsnapshot";
    const mainSnapshot = yield* snapshotArtifact({
      effect: chromium.takeMainHeapSnapshot(join(checkpointPath, mainFileName)),
      failed: {
        fileName: mainFileName,
        kind: "main",
        osProcessId: process.pid,
      },
    });

    const rendererTargets = yield* chromium.getRendererTargets;
    const rendererMetadata = (yield* Effect.forEach(
      rendererTargets,
      resolveRendererTarget,
      {
        concurrency: "unbounded",
      },
    )).filter(isDefined);
    const rendererSnapshots = yield* Effect.forEach(
      rendererMetadata,
      (metadata) => {
        const fileName = `${metadata.kind}-window-${metadata.rendererId}-generation-${metadata.generation}.heapsnapshot`;
        return snapshotArtifact({
          effect: chromium.takeRendererHeapSnapshot(
            metadata.rendererId,
            join(checkpointPath, fileName),
          ),
          failed: {
            rendererId: metadata.rendererId,
            fileName,
            generation: metadata.generation,
            kind: "renderer",
            osProcessId: metadata.osProcessId,
            windowKind: metadata.kind,
          },
        });
      },
      { concurrency: 1 },
    );
    const endedAt = new Date().toISOString();
    const snapshots = [mainSnapshot, ...rendererSnapshots];
    current.heapCheckpoints.push({
      directoryName,
      endedAt,
      index: checkpointIndex,
      snapshots,
      startedAt: checkpointStartedAt,
    });
    yield* writeManifest(current, "recording");

    const result: DesktopChromiumHeapSnapshotResult = {
      checkpointPath,
      failedSnapshotCount: snapshots.filter(
        (snapshot) => snapshot.status === "failed",
      ).length,
      snapshotCount: snapshots.length,
    };
    yield* observability.info(
      "chromium-performance-recording",
      "Chromium heap checkpoint captured",
      result,
    );
    return result;
  }).pipe(
    Effect.mapError((cause) => {
      if (
        cause instanceof DesktopChromiumPerformanceRecordingBusyError ||
        cause instanceof DesktopChromiumPerformanceRecordingNotActiveError
      ) {
        return cause;
      }
      const checkpointPath =
        activeRecording === undefined
          ? recordingsRoot
          : join(activeRecording.sessionPath, HEAP_SNAPSHOTS_DIRECTORY_NAME);
      return new DesktopChromiumHeapSnapshotError({ cause, checkpointPath });
    }),
    Effect.ensuring(
      Effect.suspend(() =>
        activeRecording === undefined || state.status !== "snapshotting"
          ? Effect.void
          : setState({
              startedAt: activeRecording.startedAt,
              status: "recording",
            }),
      ),
    ),
  );

  const captureHeapSnapshot: DesktopChromiumPerformanceRecordingShape["captureHeapSnapshot"] =
    operationGate.withPermits(1)(captureHeapSnapshotInternal);

  const stopInternal = Effect.gen(function* () {
    const current = activeRecording;
    if (current === undefined) {
      return undefined;
    }

    clearRecordingTimers(current);
    yield* setState({ startedAt: current.startedAt, status: "saving" });
    const pendingRendererHeapSample = current.rendererHeapSamplePromise;
    if (pendingRendererHeapSample !== null) {
      yield* Effect.promise(() => pendingRendererHeapSample);
    }

    if (current.traceActive) {
      yield* closeTraceSegment(current, "stop").pipe(
        Effect.catch((cause) =>
          recordWarning(
            current,
            "trace-stop",
            "Failed to save the final Chromium trace segment",
            cause,
          ).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                current.traceActive = false;
              }),
            ),
          ),
        ),
      );
    }
    yield* chromium.releaseRendererDebuggers;

    const endedAtMs = Date.now();
    const endedAt = new Date(endedAtMs).toISOString();
    const resources: ChromiumPerformanceResourcesDocument = {
      mainResourceSampleIntervalMs: CHROMIUM_RESOURCE_SAMPLE_INTERVAL_MS,
      rendererHeapSampleIntervalMs: CHROMIUM_RENDERER_HEAP_SAMPLE_INTERVAL_MS,
      rendererHeapSamples: current.rendererHeapSamples,
      resourceSamples: current.resourceSamples,
      schemaVersion: CHROMIUM_PERFORMANCE_RECORDING_SCHEMA_VERSION,
    };
    yield* writeJsonArtifact(
      filesystem,
      join(current.sessionPath, RESOURCES_FILE_NAME),
      resources,
    );
    yield* writeManifest(current, "complete", endedAt);

    const result: DesktopChromiumPerformanceRecordingResult = {
      durationMs: Math.max(0, endedAtMs - current.startedAtMs),
      heapCheckpointCount: current.heapCheckpoints.length,
      manifestPath: join(current.sessionPath, MANIFEST_FILE_NAME),
      resourceSampleCount: current.resourceSamples.length,
      sessionPath: current.sessionPath,
      traceSegmentCount: current.segments.length,
      warningCount: current.warnings.length,
    };
    activeRecording = undefined;
    yield* setState({ status: "idle" });
    yield* observability.info(
      "chromium-performance-recording",
      "Chromium performance recording saved",
      result,
    );
    return result;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopChromiumPerformanceRecordingSaveError({
          cause,
          sessionPath: activeRecording?.sessionPath ?? recordingsRoot,
        }),
    ),
    Effect.catch((error) => {
      const current = activeRecording;
      if (current !== undefined) {
        clearRecordingTimers(current);
      }
      activeRecording = undefined;
      return chromium.releaseRendererDebuggers.pipe(
        Effect.andThen(setState({ status: "idle" })),
        Effect.andThen(Effect.fail(error)),
      );
    }),
  );

  const stop: DesktopChromiumPerformanceRecordingShape["stop"] =
    operationGate.withPermits(1)(stopInternal);

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const current = activeRecording;
      if (current === undefined) {
        return;
      }
      clearRecordingTimers(current);
      if (current.traceActive) {
        const filePath = join(
          current.sessionPath,
          chromiumTraceSegmentFileName(current.segments.length),
        );
        yield* chromium
          .stopRecording(filePath)
          .pipe(
            Effect.catch((cause) =>
              observability.warn(
                "chromium-performance-recording",
                "Failed to flush Chromium tracing during shutdown",
                { cause },
              ),
            ),
          );
      }
      yield* chromium.releaseRendererDebuggers;
      activeRecording = undefined;
    }),
  );

  return DesktopChromiumPerformanceRecording.of({
    captureHeapSnapshot,
    getState: Effect.sync(() => state),
    onChanged: stateChanges.subscribe,
    start,
    stop,
  });
});

export const layer = Layer.effect(
  DesktopChromiumPerformanceRecording,
  makeDesktopChromiumPerformanceRecording,
);
