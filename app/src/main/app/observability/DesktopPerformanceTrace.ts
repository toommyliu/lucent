import { promises as fs } from "fs";
import { cpus, totalmem } from "os";
import { join } from "path";

import type { ProcessMetric } from "electron";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ElectronApp } from "../../electron/ElectronApp";
import { DesktopEnvironment } from "../DesktopEnvironment";
import { makeListenerRegistry } from "../ListenerRegistry";
import { DesktopObservability } from "./DesktopObservability";

export const PERFORMANCE_TRACE_SAMPLE_INTERVAL_MS = 1_000;

const PERFORMANCE_TRACE_DIRECTORY_NAME = "performance-traces";
const PERFORMANCE_TRACE_SCHEMA_VERSION = 1;

export type PerformanceTraceProcessType = ProcessMetric["type"];

export interface PerformanceTraceProcessSample {
  readonly cpuPercent: number;
  readonly creationTime: number;
  readonly idleWakeupsPerSecond: number;
  readonly name?: string;
  readonly peakWorkingSetKiB: number;
  readonly pid: number;
  readonly privateMemoryKiB?: number;
  readonly type: PerformanceTraceProcessType;
  readonly workingSetKiB: number;
}

export interface PerformanceTraceSample {
  readonly elapsedMs: number;
  readonly processes: readonly PerformanceTraceProcessSample[];
}

export interface PerformanceTraceDistribution {
  readonly maximum: number;
  readonly mean: number;
  readonly minimum: number;
  readonly p50: number;
  readonly p95: number;
}

export interface PerformanceTraceResourceSummary {
  readonly cpuPercent: PerformanceTraceDistribution;
  readonly idleWakeupsPerSecond: PerformanceTraceDistribution;
  readonly processCount: PerformanceTraceDistribution;
  readonly reportedPrivateMemoryKiB?: PerformanceTraceDistribution;
  readonly workingSetKiB: PerformanceTraceDistribution;
}

export interface PerformanceTraceProcessTypeSummary extends PerformanceTraceResourceSummary {
  readonly type: PerformanceTraceProcessType;
}

export interface PerformanceTraceSummary {
  readonly byProcessType: readonly PerformanceTraceProcessTypeSummary[];
  readonly sampleCount: number;
  readonly total: PerformanceTraceResourceSummary;
}

export interface PerformanceTraceMetadata {
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

interface PerformanceTraceMetadataEvent {
  readonly args: { readonly name: string };
  readonly name: "process_name";
  readonly ph: "M";
  readonly pid: number;
  readonly tid: 0;
}

interface PerformanceTraceCounterEvent {
  readonly args: Readonly<Record<string, number>>;
  readonly cat: "lucent.performance";
  readonly name: "Process resources";
  readonly ph: "C";
  readonly pid: number;
  readonly tid: 0;
  readonly ts: number;
}

export interface PerformanceTraceDocument {
  readonly displayTimeUnit: "ms";
  readonly lucent: {
    readonly durationMs: number;
    readonly endedAt: string;
    readonly metadata: PerformanceTraceMetadata;
    readonly sampleIntervalMs: number;
    readonly samples: readonly PerformanceTraceSample[];
    readonly schemaVersion: number;
    readonly startedAt: string;
    readonly summary: PerformanceTraceSummary;
  };
  readonly traceEvents: readonly (
    | PerformanceTraceCounterEvent
    | PerformanceTraceMetadataEvent
  )[];
}

export type DesktopPerformanceTraceState =
  | { readonly status: "idle" }
  | { readonly startedAt: string; readonly status: "recording" }
  | { readonly startedAt: string; readonly status: "saving" };

export interface DesktopPerformanceTraceResult {
  readonly durationMs: number;
  readonly filePath: string;
  readonly sampleCount: number;
}

export class DesktopPerformanceTraceBusyError extends Schema.TaggedError<DesktopPerformanceTraceBusyError>()(
  "DesktopPerformanceTraceBusyError",
  {
    status: Schema.String,
  },
) {
  override get message(): string {
    return `A performance trace is already ${this.status}.`;
  }
}

export class DesktopPerformanceTraceWriteError extends Schema.TaggedError<DesktopPerformanceTraceWriteError>()(
  "DesktopPerformanceTraceWriteError",
  {
    cause: Schema.Defect(),
    filePath: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to save the performance trace to ${this.filePath}.`;
  }
}

export interface DesktopPerformanceTraceShape {
  readonly getState: Effect.Effect<DesktopPerformanceTraceState>;
  readonly onChanged: (
    listener: (state: DesktopPerformanceTraceState) => void,
  ) => Effect.Effect<() => void>;
  readonly start: Effect.Effect<void, DesktopPerformanceTraceBusyError>;
  readonly stop: Effect.Effect<
    DesktopPerformanceTraceResult | undefined,
    DesktopPerformanceTraceWriteError
  >;
}

export class DesktopPerformanceTrace extends Context.Service<
  DesktopPerformanceTrace,
  DesktopPerformanceTraceShape
>()("lucent/desktop/app/observability/DesktopPerformanceTrace") {}

interface AggregateResourceSample {
  readonly cpuPercent: number;
  readonly idleWakeupsPerSecond: number;
  readonly processCount: number;
  readonly reportedPrivateMemoryKiB?: number;
  readonly workingSetKiB: number;
}

interface ActivePerformanceTrace {
  readonly appVersion: string;
  readonly samples: PerformanceTraceSample[];
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly timer: NodeJS.Timeout;
}

const roundMetric = (value: number): number =>
  Math.round(value * 1_000) / 1_000;

const percentile = (
  sortedValues: readonly number[],
  quantile: number,
): number => {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.max(
    0,
    Math.min(
      sortedValues.length - 1,
      Math.ceil(sortedValues.length * quantile) - 1,
    ),
  );
  return sortedValues[index] ?? 0;
};

const summarizeValues = (
  values: readonly number[],
): PerformanceTraceDistribution => {
  if (values.length === 0) {
    return {
      maximum: 0,
      mean: 0,
      minimum: 0,
      p50: 0,
      p95: 0,
    };
  }

  const sortedValues = values.toSorted((left, right) => left - right);
  const total = sortedValues.reduce((sum, value) => sum + value, 0);

  return {
    maximum: roundMetric(sortedValues[sortedValues.length - 1] ?? 0),
    mean: roundMetric(total / sortedValues.length),
    minimum: roundMetric(sortedValues[0] ?? 0),
    p50: roundMetric(percentile(sortedValues, 0.5)),
    p95: roundMetric(percentile(sortedValues, 0.95)),
  };
};

const aggregateProcesses = (
  processes: readonly PerformanceTraceProcessSample[],
  options: {
    readonly includePrivateMemory: boolean;
    readonly type?: PerformanceTraceProcessType;
  },
): AggregateResourceSample => {
  const matchingProcesses =
    options.type === undefined
      ? processes
      : processes.filter((process) => process.type === options.type);
  const values = matchingProcesses.reduce(
    (aggregate, process) => ({
      cpuPercent: aggregate.cpuPercent + process.cpuPercent,
      idleWakeupsPerSecond:
        aggregate.idleWakeupsPerSecond + process.idleWakeupsPerSecond,
      reportedPrivateMemoryKiB:
        aggregate.reportedPrivateMemoryKiB + (process.privateMemoryKiB ?? 0),
      workingSetKiB: aggregate.workingSetKiB + process.workingSetKiB,
    }),
    {
      cpuPercent: 0,
      idleWakeupsPerSecond: 0,
      reportedPrivateMemoryKiB: 0,
      workingSetKiB: 0,
    },
  );

  return {
    cpuPercent: values.cpuPercent,
    idleWakeupsPerSecond: values.idleWakeupsPerSecond,
    processCount: matchingProcesses.length,
    ...(options.includePrivateMemory
      ? { reportedPrivateMemoryKiB: values.reportedPrivateMemoryKiB }
      : {}),
    workingSetKiB: values.workingSetKiB,
  };
};

const summarizeAggregateSamples = (
  samples: readonly AggregateResourceSample[],
): PerformanceTraceResourceSummary => {
  const privateMemoryValues = samples.flatMap((sample) =>
    sample.reportedPrivateMemoryKiB === undefined
      ? []
      : [sample.reportedPrivateMemoryKiB],
  );

  return {
    cpuPercent: summarizeValues(samples.map((sample) => sample.cpuPercent)),
    idleWakeupsPerSecond: summarizeValues(
      samples.map((sample) => sample.idleWakeupsPerSecond),
    ),
    processCount: summarizeValues(samples.map((sample) => sample.processCount)),
    ...(privateMemoryValues.length === 0
      ? {}
      : { reportedPrivateMemoryKiB: summarizeValues(privateMemoryValues) }),
    workingSetKiB: summarizeValues(
      samples.map((sample) => sample.workingSetKiB),
    ),
  };
};

/** Summarizes each process type and the combined Lucent process tree. */
export const summarizePerformanceTrace = (
  samples: readonly PerformanceTraceSample[],
): PerformanceTraceSummary => {
  const processTypes = [
    ...new Set(
      samples.flatMap((sample) =>
        sample.processes.map((process) => process.type),
      ),
    ),
  ].toSorted();
  const includesPrivateMemory = samples.some((sample) =>
    sample.processes.some((process) => process.privateMemoryKiB !== undefined),
  );
  const total = samples.map((sample) =>
    aggregateProcesses(sample.processes, {
      includePrivateMemory: includesPrivateMemory,
    }),
  );
  const byProcessType = processTypes.map((type) => {
    const typeIncludesPrivateMemory = samples.some((sample) =>
      sample.processes.some(
        (process) =>
          process.type === type && process.privateMemoryKiB !== undefined,
      ),
    );
    const typeSamples = samples.map((sample) =>
      aggregateProcesses(sample.processes, {
        includePrivateMemory: typeIncludesPrivateMemory,
        type,
      }),
    );

    return Object.assign(
      {
        type,
      },
      summarizeAggregateSamples(typeSamples),
    );
  });

  return {
    byProcessType,
    sampleCount: samples.length,
    total: summarizeAggregateSamples(total),
  };
};

const processLabel = (process: PerformanceTraceProcessSample): string =>
  process.name === undefined
    ? process.type
    : `${process.type}: ${process.name}`;

/** Emits Chrome trace counter events so the recording opens in trace viewers. */
const createTraceEvents = (
  samples: readonly PerformanceTraceSample[],
): readonly (
  | PerformanceTraceCounterEvent
  | PerformanceTraceMetadataEvent
)[] => {
  const processNames = new Map<number, string>();
  for (const sample of samples) {
    for (const process of sample.processes) {
      processNames.set(process.pid, processLabel(process));
    }
  }

  const metadataEvents: PerformanceTraceMetadataEvent[] = [
    ...processNames.entries(),
  ].map(([pid, name]) => ({
    args: { name },
    name: "process_name",
    ph: "M",
    pid,
    tid: 0,
  }));
  const counterEvents = samples.flatMap((sample) =>
    sample.processes.map(
      (process): PerformanceTraceCounterEvent => ({
        args: {
          "CPU (%)": process.cpuPercent,
          "Idle wakeups/s": process.idleWakeupsPerSecond,
          "Peak working set (KiB)": process.peakWorkingSetKiB,
          ...(process.privateMemoryKiB === undefined
            ? {}
            : { "Private memory (KiB)": process.privateMemoryKiB }),
          "Working set (KiB)": process.workingSetKiB,
        },
        cat: "lucent.performance",
        name: "Process resources",
        ph: "C",
        pid: process.pid,
        tid: 0,
        ts: sample.elapsedMs * 1_000,
      }),
    ),
  );

  return [...metadataEvents, ...counterEvents];
};

/** Builds the portable trace document written to disk at the end of a run. */
export const createPerformanceTraceDocument = (input: {
  readonly endedAt: string;
  readonly endedAtMs: number;
  readonly metadata: PerformanceTraceMetadata;
  readonly samples: readonly PerformanceTraceSample[];
  readonly startedAt: string;
  readonly startedAtMs: number;
}): PerformanceTraceDocument => ({
  displayTimeUnit: "ms",
  lucent: {
    durationMs: Math.max(0, input.endedAtMs - input.startedAtMs),
    endedAt: input.endedAt,
    metadata: input.metadata,
    sampleIntervalMs: PERFORMANCE_TRACE_SAMPLE_INTERVAL_MS,
    samples: input.samples,
    schemaVersion: PERFORMANCE_TRACE_SCHEMA_VERSION,
    startedAt: input.startedAt,
    summary: summarizePerformanceTrace(input.samples),
  },
  traceEvents: createTraceEvents(input.samples),
});

/** Normalizes Electron's platform-dependent process metrics for saved artifacts. */
export const normalizePerformanceTraceMetric = (
  metric: ProcessMetric,
): PerformanceTraceProcessSample => ({
  cpuPercent: metric.cpu.percentCPUUsage,
  creationTime: metric.creationTime,
  idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
  ...(metric.name === undefined ? {} : { name: metric.name }),
  peakWorkingSetKiB: metric.memory.peakWorkingSetSize,
  pid: metric.pid,
  ...(metric.memory.privateBytes === undefined
    ? {}
    : { privateMemoryKiB: metric.memory.privateBytes }),
  type: metric.type,
  workingSetKiB: metric.memory.workingSetSize,
});

const traceFileName = (startedAt: string): string =>
  `lucent-performance-trace-${startedAt.replace(/[:.]/g, "-")}.json`;

const makeDesktopPerformanceTrace = Effect.gen(function* () {
  const electronApp = yield* ElectronApp;
  const env = yield* DesktopEnvironment;
  const observability = yield* DesktopObservability;
  const stateChanges = makeListenerRegistry<DesktopPerformanceTraceState>();
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const runSync = Effect.runSyncWith(context);
  const tracesDir = join(env.appDataDir, PERFORMANCE_TRACE_DIRECTORY_NAME);
  let state: DesktopPerformanceTraceState = { status: "idle" };
  let activeTrace: ActivePerformanceTrace | undefined;

  const setState = Effect.fn("DesktopPerformanceTrace.setState")(function* (
    nextState: DesktopPerformanceTraceState,
  ) {
    state = nextState;
    yield* stateChanges.publish(nextState);
  });

  const captureSample = (): void => {
    const current = activeTrace;
    if (current === undefined) {
      return;
    }

    try {
      const metrics = runSync(electronApp.getAppMetrics);
      current.samples.push({
        elapsedMs: Math.max(0, Date.now() - current.startedAtMs),
        processes: metrics.map(normalizePerformanceTraceMetric),
      });
    } catch (cause) {
      void runPromise(
        observability.warn(
          "performance-trace",
          "Failed to capture performance trace sample",
          { cause },
        ),
      );
    }
  };

  const start: DesktopPerformanceTraceShape["start"] = Effect.gen(function* () {
    if (state.status !== "idle") {
      return yield* new DesktopPerformanceTraceBusyError({
        status: state.status,
      });
    }

    const appVersion = yield* electronApp.getVersion;
    // Electron reports zero CPU on the first read, so prime its interval counters.
    yield* electronApp.getAppMetrics;
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const timer = setInterval(
      captureSample,
      PERFORMANCE_TRACE_SAMPLE_INTERVAL_MS,
    );
    timer.unref?.();
    activeTrace = {
      appVersion,
      samples: [],
      startedAt,
      startedAtMs,
      timer,
    };
    yield* setState({ startedAt, status: "recording" });
    yield* observability.info(
      "performance-trace",
      "Performance trace recording started",
      { sampleIntervalMs: PERFORMANCE_TRACE_SAMPLE_INTERVAL_MS, startedAt },
    );
  });

  const stop: DesktopPerformanceTraceShape["stop"] = Effect.gen(function* () {
    const current = activeTrace;
    if (current === undefined) {
      return undefined;
    }

    clearInterval(current.timer);
    activeTrace = undefined;
    yield* setState({ startedAt: current.startedAt, status: "saving" });

    if (current.samples.length === 0) {
      const metrics = yield* electronApp.getAppMetrics;
      current.samples.push({
        elapsedMs: Math.max(0, Date.now() - current.startedAtMs),
        processes: metrics.map(normalizePerformanceTraceMetric),
      });
    }

    const endedAtMs = Date.now();
    const endedAt = new Date(endedAtMs).toISOString();
    const cpuList = cpus();
    const document = createPerformanceTraceDocument({
      endedAt,
      endedAtMs,
      metadata: {
        appVersion: current.appVersion,
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
      samples: current.samples,
      startedAt: current.startedAt,
      startedAtMs: current.startedAtMs,
    });
    const filePath = join(tracesDir, traceFileName(current.startedAt));
    const writeTrace = Effect.tryPromise({
      try: async () => {
        await fs.mkdir(tracesDir, { recursive: true });
        await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
      },
      catch: (cause) =>
        new DesktopPerformanceTraceWriteError({ cause, filePath }),
    });

    yield* writeTrace.pipe(
      Effect.catch((error) =>
        setState({ status: "idle" }).pipe(
          Effect.flatMap(() => Effect.fail(error)),
        ),
      ),
    );
    yield* setState({ status: "idle" });

    const result: DesktopPerformanceTraceResult = {
      durationMs: document.lucent.durationMs,
      filePath,
      sampleCount: document.lucent.summary.sampleCount,
    };
    yield* observability.info(
      "performance-trace",
      "Performance trace saved",
      result,
    );
    return result;
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (activeTrace !== undefined) {
        clearInterval(activeTrace.timer);
        activeTrace = undefined;
      }
    }),
  );

  return DesktopPerformanceTrace.of({
    getState: Effect.sync(() => state),
    onChanged: stateChanges.subscribe,
    start,
    stop,
  });
});

export const layer = Layer.effect(
  DesktopPerformanceTrace,
  makeDesktopPerformanceTrace,
);
