import { describe, expect, it } from "@effect/vitest";

import type { DesktopTraceSpan } from "../../../shared/ipc";
import { parseDesktopTraceRecords } from "./DesktopTraceLog";

const traceSpan = (name: string): DesktopTraceSpan => ({
  attributes: {},
  durationMs: 1,
  endTimeUnixNano: "2",
  events: [],
  exit: { _tag: "Success" },
  kind: "internal",
  links: [],
  name,
  sampled: true,
  source: "effect",
  spanId: `span-${name}`,
  startTimeUnixNano: "1",
  traceId: "trace-1",
});

describe("DesktopTraceLog", () => {
  it("accepts schema-valid spans and ignores malformed records", () => {
    const span = traceSpan("accepted");
    const result = parseDesktopTraceRecords([
      [
        JSON.stringify({
          at: "2026-08-24T12:00:00.000Z",
          event: "recording.started",
        }),
        JSON.stringify({
          component: "trace",
          data: span,
          event: "span.completed",
        }),
        JSON.stringify({
          component: "trace",
          data: { ...span, durationMs: "invalid" },
          event: "span.completed",
        }),
        "not json",
      ].join("\n"),
    ]);

    expect(result).toEqual({
      recordingStartedAt: "2026-08-24T12:00:00.000Z",
      spans: [span],
      truncated: false,
    });
  });

  it("keeps only spans from the latest recording", () => {
    const previous = traceSpan("previous");
    const current = traceSpan("current");
    const result = parseDesktopTraceRecords([
      [
        JSON.stringify({
          at: "2026-08-24T11:00:00.000Z",
          event: "recording.started",
        }),
        JSON.stringify({
          component: "trace",
          data: previous,
          event: "span.completed",
        }),
      ].join("\n"),
      [
        JSON.stringify({
          at: "2026-08-24T12:00:00.000Z",
          event: "recording.started",
        }),
        JSON.stringify({
          component: "trace",
          data: current,
          event: "span.completed",
        }),
      ].join("\n"),
    ]);

    expect(result).toEqual({
      recordingStartedAt: "2026-08-24T12:00:00.000Z",
      spans: [current],
      truncated: false,
    });
  });
});
