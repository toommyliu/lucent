import { describe, expect, it } from "@effect/vitest";

import type { DesktopTraceSpan } from "../../../shared/ipc";
import { makeDesktopTraceBuffer } from "./DesktopTraceBuffer";

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

describe("DesktopTraceBuffer", () => {
  it("retains the latest bounded span window", () => {
    const buffer = makeDesktopTraceBuffer("2026-08-25T12:00:00.000Z", {
      maxSpans: 2,
    });
    const first = traceSpan("first");
    const second = traceSpan("second");
    const third = traceSpan("third");

    buffer.append(first);
    buffer.append(second);
    expect(buffer.snapshot()).toEqual({
      recordingStartedAt: "2026-08-25T12:00:00.000Z",
      spans: [first, second],
      truncated: false,
    });

    buffer.append(third);
    expect(buffer.snapshot()).toEqual({
      recordingStartedAt: "2026-08-25T12:00:00.000Z",
      spans: [second, third],
      truncated: true,
    });
  });

  it("returns snapshots that callers cannot append to", () => {
    const buffer = makeDesktopTraceBuffer("2026-08-25T12:00:00.000Z");
    buffer.append(traceSpan("kept"));

    const snapshot = buffer.snapshot();
    (snapshot.spans as DesktopTraceSpan[]).push(traceSpan("external"));

    expect(buffer.snapshot().spans.map(({ name }) => name)).toEqual(["kept"]);
  });
});
