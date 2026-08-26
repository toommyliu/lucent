export const CHROMIUM_PERFORMANCE_RECORDING_SCHEMA_VERSION = 2;

export const CHROMIUM_TRACE_BUFFER_SIZE_KIB = 256 * 1024;
// Electron 11's native getTraceBufferUsage result conversion can crash the
// main process, so long recordings use short time-bounded segments instead.
export const CHROMIUM_TRACE_SEGMENT_CHECK_INTERVAL_MS = 1_000;
export const CHROMIUM_TRACE_SEGMENT_MAX_DURATION_MS = 2 * 60 * 1_000;
export const CHROMIUM_RESOURCE_SAMPLE_INTERVAL_MS = 1_000;
export const CHROMIUM_RENDERER_HEAP_SAMPLE_INTERVAL_MS = 5_000;
export const CHROMIUM_RENDERER_HEAP_SAMPLE_TIMEOUT_MS = 4_000;

/** Trace categories used by the standard, long-running Chromium recording preset. */
export const CHROMIUM_PERFORMANCE_TRACE_CATEGORIES = [
  "blink.console",
  "blink.user_timing",
  "cc",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-v8.cpu_profiler",
  "electron",
  "gpu",
  "ipc",
  "latencyInfo",
  "loading",
  "navigation",
  "renderer.scheduler",
  "sequence_manager",
  "toplevel",
  "v8",
  "v8.execute",
  "viz",
] as const;

/** Prevents Chromium's unspecified default categories from inflating recordings. */
export const CHROMIUM_PERFORMANCE_TRACE_EXCLUDED_CATEGORIES = ["*"] as const;

export type ChromiumTraceRotationReason = "duration";

/** Selects whether the current trace segment should be flushed and restarted. */
export const chromiumTraceRotationReason = (
  durationMs: number,
): ChromiumTraceRotationReason | null =>
  durationMs >= CHROMIUM_TRACE_SEGMENT_MAX_DURATION_MS ? "duration" : null;

/** Produces filesystem-safe ISO timestamp text while preserving readability. */
export const chromiumRecordingTimestamp = (timestamp: string): string =>
  timestamp.replace(/[:.]/g, "-");

/** Produces stable, naturally sorted trace segment names. */
export const chromiumTraceSegmentFileName = (index: number): string =>
  `trace-${String(index).padStart(3, "0")}.json`;

/** Produces stable, naturally sorted heap-checkpoint directory names. */
export const chromiumHeapCheckpointDirectoryName = (
  index: number,
  startedAt: string,
): string =>
  `checkpoint-${String(index).padStart(3, "0")}-${chromiumRecordingTimestamp(startedAt)}`;
