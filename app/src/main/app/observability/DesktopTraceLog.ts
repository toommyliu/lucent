import { promises as fs } from "fs";

import * as Schema from "effect/Schema";

import {
  DesktopTraceSpanSchema,
  type DesktopTraceResponse,
  type DesktopTraceSpan,
} from "../../../shared/ipc";

const MAX_TRACE_SPANS = 20_000;

const DesktopRecordingStartedRecordSchema = Schema.Struct({
  at: Schema.optionalKey(Schema.String),
  event: Schema.Literal("recording.started"),
});
const DesktopCompletedTraceRecordSchema = Schema.Struct({
  component: Schema.Literal("trace"),
  data: DesktopTraceSpanSchema,
  event: Schema.Literal("span.completed"),
});
const isDesktopRecordingStartedRecord = Schema.is(
  DesktopRecordingStartedRecordSchema,
);
const isDesktopCompletedTraceRecord = Schema.is(
  DesktopCompletedTraceRecordSchema,
);

const errorCode = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause
    ? (cause as NodeJS.ErrnoException).code
    : undefined;

const readLogFile = async (path: string): Promise<string> => {
  try {
    return await fs.readFile(path, "utf8");
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") {
      return "";
    }
    throw cause;
  }
};

export const isDesktopTraceSpan = Schema.is(DesktopTraceSpanSchema);

export const parseDesktopTraceRecords = (
  sources: readonly string[],
): DesktopTraceResponse => {
  const spans: DesktopTraceSpan[] = [];
  let recordingStartedAt: string | null = null;
  let truncated = false;

  for (const source of sources) {
    for (const line of source.split("\n")) {
      if (line.length === 0) {
        continue;
      }

      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (isDesktopRecordingStartedRecord(record)) {
        recordingStartedAt = record.at ?? recordingStartedAt;
        spans.length = 0;
        truncated = false;
        continue;
      }
      if (!isDesktopCompletedTraceRecord(record)) {
        continue;
      }
      if (spans.length >= MAX_TRACE_SPANS) {
        truncated = true;
        continue;
      }
      spans.push(record.data);
    }
  }

  return {
    recordingStartedAt,
    spans,
    truncated: truncated || recordingStartedAt === null,
  };
};

/** Reads trace history from the current and previous rotating desktop logs. */
export const loadLatestDesktopTraces = async (
  logFilePath: string,
): Promise<DesktopTraceResponse> => {
  const current = await readLogFile(logFilePath);
  if (current.includes('"event":"recording.started"')) {
    return parseDesktopTraceRecords([current]);
  }

  const previous = await readLogFile(`${logFilePath}.1`);
  return parseDesktopTraceRecords([previous, current]);
};
