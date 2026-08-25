import {
  DESKTOP_TRACE_MAX_SPANS,
  type DesktopTraceResponse,
  type DesktopTraceSpan,
} from "../../../shared/ipc";

export interface DesktopTraceBuffer {
  readonly append: (span: DesktopTraceSpan) => void;
  readonly snapshot: () => DesktopTraceResponse;
}

export interface DesktopTraceBufferOptions {
  readonly maxSpans?: number;
}

/** Keeps the latest completed spans for HTTP snapshots and SSE recovery. */
export const makeDesktopTraceBuffer = (
  recordingStartedAt: string | null,
  options: DesktopTraceBufferOptions = {},
): DesktopTraceBuffer => {
  const maxSpans = Math.max(1, options.maxSpans ?? DESKTOP_TRACE_MAX_SPANS);
  const spans: DesktopTraceSpan[] = [];
  let nextSpanIndex = 0;
  let truncated = false;

  const append = (span: DesktopTraceSpan): void => {
    if (spans.length < maxSpans) {
      spans.push(span);
      return;
    }

    spans[nextSpanIndex] = span;
    nextSpanIndex = (nextSpanIndex + 1) % maxSpans;
    truncated = true;
  };

  const snapshot = (): DesktopTraceResponse => ({
    recordingStartedAt,
    spans:
      nextSpanIndex === 0
        ? [...spans]
        : [...spans.slice(nextSpanIndex), ...spans.slice(0, nextSpanIndex)],
    truncated,
  });

  return { append, snapshot };
};
