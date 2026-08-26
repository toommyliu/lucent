import { describe, expect, it } from "vitest";

import {
  DESKTOP_TRACE_MAX_SPANS,
  mergeTraceSpans,
  sortTraceSpans,
  type DesktopTraceSpan,
} from "@/trace-model";

function traceSpan(index: number, spanId = `span-${index}`): DesktopTraceSpan {
  return {
    attributes: {},
    durationMs: 1,
    endTimeUnixNano: String(index + 1),
    events: [],
    exit: { _tag: "Success" },
    kind: "internal",
    links: [],
    name: `span ${index}`,
    sampled: true,
    source: "effect",
    spanId,
    startTimeUnixNano: String(index),
    traceId: "trace-1",
  };
}

describe("trace span collections", () => {
  it("merges sorted batches and replaces spans with matching keys", () => {
    const replaced = traceSpan(1, "shared");
    const replacement = traceSpan(3, "shared");

    const merged = mergeTraceSpans(
      [replaced, traceSpan(4)],
      [traceSpan(2), replacement],
    );

    expect(merged.map(({ name }) => name)).toEqual([
      "span 2",
      "span 3",
      "span 4",
    ]);
  });

  it("retains the latest bounded span window", () => {
    const spans = Array.from(
      { length: DESKTOP_TRACE_MAX_SPANS + 1 },
      (_, index) => traceSpan(index),
    );

    const sorted = sortTraceSpans(spans.toReversed());
    const merged = mergeTraceSpans(spans.slice(0, -1), [spans.at(-1)!]);

    expect(sorted).toHaveLength(DESKTOP_TRACE_MAX_SPANS);
    expect(sorted[0]?.name).toBe("span 1");
    expect(merged).toHaveLength(DESKTOP_TRACE_MAX_SPANS);
    expect(merged[0]?.name).toBe("span 1");
  });
});
