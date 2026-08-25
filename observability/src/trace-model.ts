import {
  DESKTOP_TRACE_MAX_SPANS,
  type DesktopTraceResponse,
  type DesktopTraceSpan,
} from "../../app/src/shared/ipc/diagnostics";

export { DESKTOP_TRACE_MAX_SPANS };
export type { DesktopTraceResponse, DesktopTraceSpan };

export type OutcomeFilter = "all" | DesktopTraceSpan["exit"]["_tag"];
export type SourceFilter = "all" | DesktopTraceSpan["source"];
export type TimelineScale = "fit" | "0.05" | "0.2" | "1" | "4";

export const TRACE_AXIS_HEIGHT = 32;
export const TRACE_LABEL_WIDTH = 300;
export const TRACE_ROW_HEIGHT = 32;
export const TRACE_TIMELINE_GUTTER = 6;

const TRACE_OUTCOME_FIELD = "_tag" as const;

export function traceKey(span: DesktopTraceSpan): string {
  return `${span.traceId}:${span.spanId}`;
}

export function traceOutcome(
  span: DesktopTraceSpan,
): DesktopTraceSpan["exit"]["_tag"] {
  return span.exit[TRACE_OUTCOME_FIELD];
}

export function asNanos(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function compareTraceStarts(
  left: DesktopTraceSpan,
  right: DesktopTraceSpan,
): number {
  const leftStart = asNanos(left.startTimeUnixNano);
  const rightStart = asNanos(right.startTimeUnixNano);
  return leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : 0;
}

/** Merges a live batch without re-sorting an already ordered trace window. */
export function mergeTraceSpans(
  current: readonly DesktopTraceSpan[],
  incoming: readonly DesktopTraceSpan[],
): readonly DesktopTraceSpan[] {
  if (incoming.length === 0) {
    return sortTraceSpans(current);
  }

  const incomingByKey = new Map<string, DesktopTraceSpan>();
  for (const span of incoming) {
    incomingByKey.set(traceKey(span), span);
  }

  const retainedCurrent: DesktopTraceSpan[] = [];
  let currentIsSorted = true;
  for (const span of current) {
    if (incomingByKey.has(traceKey(span))) {
      continue;
    }
    const previous = retainedCurrent.at(-1);
    if (previous !== undefined && compareTraceStarts(previous, span) > 0) {
      currentIsSorted = false;
    }
    retainedCurrent.push(span);
  }

  const sortedCurrent = currentIsSorted
    ? retainedCurrent
    : retainedCurrent.toSorted(compareTraceStarts);
  const sortedIncoming = [...incomingByKey.values()].toSorted(
    compareTraceStarts,
  );
  const merged: DesktopTraceSpan[] = [];
  let currentIndex = 0;
  let incomingIndex = 0;

  while (
    currentIndex < sortedCurrent.length &&
    incomingIndex < sortedIncoming.length
  ) {
    if (
      compareTraceStarts(
        sortedCurrent[currentIndex],
        sortedIncoming[incomingIndex],
      ) <= 0
    ) {
      merged.push(sortedCurrent[currentIndex]);
      currentIndex += 1;
    } else {
      merged.push(sortedIncoming[incomingIndex]);
      incomingIndex += 1;
    }
  }

  merged.push(
    ...sortedCurrent.slice(currentIndex),
    ...sortedIncoming.slice(incomingIndex),
  );
  return merged.length > DESKTOP_TRACE_MAX_SPANS
    ? merged.slice(-DESKTOP_TRACE_MAX_SPANS)
    : merged;
}

export function sortTraceSpans(
  spans: readonly DesktopTraceSpan[],
): readonly DesktopTraceSpan[] {
  const sorted = spans.toSorted(compareTraceStarts);
  return sorted.length > DESKTOP_TRACE_MAX_SPANS
    ? sorted.slice(-DESKTOP_TRACE_MAX_SPANS)
    : sorted;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 0.001) {
    return `${Math.round(durationMs * 1_000_000)} ns`;
  }
  if (durationMs < 1) {
    return `${(durationMs * 1_000).toFixed(2)} µs`;
  }
  if (durationMs < 1_000) {
    return `${durationMs.toFixed(durationMs < 10 ? 3 : 1)} ms`;
  }
  return `${(durationMs / 1_000).toFixed(2)} s`;
}

export function filterTraceSpans(
  spans: readonly DesktopTraceSpan[],
  query: string,
  outcome: OutcomeFilter,
  source: SourceFilter,
): readonly DesktopTraceSpan[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return spans.filter((span) => {
    if (outcome !== "all" && traceOutcome(span) !== outcome) {
      return false;
    }
    if (source !== "all" && span.source !== source) {
      return false;
    }
    if (normalizedQuery.length === 0) {
      return true;
    }

    let attributes = "";
    try {
      attributes = JSON.stringify(span.attributes).toLocaleLowerCase();
    } catch {
      // A malformed attribute should not hide otherwise searchable span data.
    }

    return (
      span.name.toLocaleLowerCase().includes(normalizedQuery) ||
      span.traceId.toLocaleLowerCase().includes(normalizedQuery) ||
      span.spanId.toLocaleLowerCase().includes(normalizedQuery) ||
      attributes.includes(normalizedQuery)
    );
  });
}

export function traceDepths(
  spans: readonly DesktopTraceSpan[],
): ReadonlyMap<string, number> {
  const byKey = new Map(spans.map((span) => [traceKey(span), span]));
  const depths = new Map<string, number>();

  for (const span of spans) {
    let depth = 0;
    let parentSpanId = span.parentSpanId;
    const visited = new Set<string>();

    while (parentSpanId !== undefined && depth < 12) {
      const parentKey = `${span.traceId}:${parentSpanId}`;
      if (visited.has(parentKey)) {
        break;
      }
      visited.add(parentKey);

      const parent = byKey.get(parentKey);
      if (parent === undefined) {
        break;
      }
      depth += 1;
      parentSpanId = parent.parentSpanId;
    }

    depths.set(traceKey(span), depth);
  }

  return depths;
}
