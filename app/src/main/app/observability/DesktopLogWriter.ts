import { promises as fs } from "fs";

const FLUSH_INTERVAL_MS = 250;
const MAX_LOG_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_RECORDS = 256;
const MAX_RECORD_BYTES = 1024 * 1024;
const PREVIEW_BYTES = 128 * 1024;
const ROTATION_COUNT = 4;

export const desktopLogErrorDetails = (cause: unknown): unknown => {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
    };
  }

  return cause;
};

const fallbackSerializationRecord = () => ({
  at: new Date().toISOString(),
  level: "error",
  component: "observability",
  message: "Failed to serialize log record",
});

const serializeDirect = (record: unknown): string => {
  try {
    return `${JSON.stringify(record)}\n`;
  } catch {
    return `${JSON.stringify(fallbackSerializationRecord())}\n`;
  }
};

const serializeDiagnostic = (record: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    const source = JSON.stringify(record, (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (value instanceof Error) {
        return desktopLogErrorDetails(value);
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    });
    if (source === undefined) {
      return `${JSON.stringify(fallbackSerializationRecord())}\n`;
    }

    const bytes = Buffer.byteLength(source, "utf8");
    if (bytes <= MAX_RECORD_BYTES) {
      return `${source}\n`;
    }

    const preview = Buffer.from(source, "utf8")
      .subarray(0, PREVIEW_BYTES)
      .toString("utf8");
    return `${JSON.stringify({
      at: new Date().toISOString(),
      level: "warn",
      component: "observability",
      message: "Log record truncated",
      data: { bytes, preview },
    })}\n`;
  } catch {
    return `${JSON.stringify(fallbackSerializationRecord())}\n`;
  }
};

const isMissingFileError = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as NodeJS.ErrnoException).code === "ENOENT";

const removeIfPresent = async (path: string): Promise<void> => {
  try {
    await fs.unlink(path);
  } catch (cause) {
    if (!isMissingFileError(cause)) {
      throw cause;
    }
  }
};

const renameIfPresent = async (from: string, to: string): Promise<void> => {
  try {
    await fs.rename(from, to);
  } catch (cause) {
    if (!isMissingFileError(cause)) {
      throw cause;
    }
  }
};

export const appendDesktopLogRecord = async (
  logsDir: string,
  logFilePath: string,
  record: unknown,
): Promise<void> => {
  await fs.mkdir(logsDir, { recursive: true });
  await fs.appendFile(logFilePath, serializeDirect(record), "utf8");
};

export interface DesktopLogWriter {
  readonly close: (finalRecord: unknown) => Promise<void>;
  readonly write: (record: unknown) => void;
}

/** Queues observability records so serialization and disk I/O stay off instrumented paths. */
export const makeBufferedDesktopLogWriter = (
  logsDir: string,
  logFilePath: string,
): DesktopLogWriter => {
  let closed = false;
  let dropped = 0;
  let fileBytes: number | undefined;
  let flushTimer: NodeJS.Timeout | undefined;
  let pending: unknown[] = [];
  let writeInFlight: Promise<void> | undefined;

  const rotate = async (): Promise<void> => {
    await removeIfPresent(`${logFilePath}.${ROTATION_COUNT}`);
    for (let index = ROTATION_COUNT - 1; index >= 1; index -= 1) {
      await renameIfPresent(
        `${logFilePath}.${index}`,
        `${logFilePath}.${index + 1}`,
      );
    }
    await renameIfPresent(logFilePath, `${logFilePath}.1`);
    fileBytes = 0;
  };

  const append = async (source: string, bytes: number): Promise<void> => {
    await fs.mkdir(logsDir, { recursive: true });
    if (fileBytes === undefined) {
      try {
        fileBytes = (await fs.stat(logFilePath)).size;
      } catch (cause) {
        if (!isMissingFileError(cause)) {
          throw cause;
        }
        fileBytes = 0;
      }
    }
    if (fileBytes > 0 && fileBytes + bytes > MAX_LOG_BYTES) {
      await rotate();
    }
    await fs.appendFile(logFilePath, source, "utf8");
    fileBytes += bytes;
  };

  const flush = (): Promise<void> => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (writeInFlight !== undefined) {
      return writeInFlight;
    }
    if (pending.length === 0 && dropped === 0) {
      return Promise.resolve();
    }

    const records = pending;
    let droppedRecords = dropped;
    pending = [];
    dropped = 0;

    const serializedRecords: string[] = [];
    let bytes = 0;
    for (const record of records) {
      const serialized = serializeDiagnostic(record);
      const recordBytes = Buffer.byteLength(serialized, "utf8");
      if (bytes + recordBytes > MAX_BATCH_BYTES) {
        droppedRecords += 1;
        continue;
      }
      serializedRecords.push(serialized);
      bytes += recordBytes;
    }

    let source = serializedRecords.join("");
    if (droppedRecords > 0) {
      const droppedSource = serializeDiagnostic({
        at: new Date().toISOString(),
        level: "warn",
        component: "observability",
        message: "Diagnostic records dropped",
        event: "records.dropped",
        data: { count: droppedRecords },
      });
      source += droppedSource;
      bytes += Buffer.byteLength(droppedSource, "utf8");
    }

    writeInFlight = append(source, bytes)
      .catch(() => undefined)
      .finally(() => {
        writeInFlight = undefined;
        if (!closed && (pending.length > 0 || dropped > 0)) {
          scheduleFlush(0);
        }
      });
    return writeInFlight;
  };

  const scheduleFlush = (delayMs = FLUSH_INTERVAL_MS): void => {
    if (flushTimer !== undefined && delayMs !== 0) {
      return;
    }
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flush();
    }, delayMs);
    flushTimer.unref?.();
  };

  const write = (record: unknown): void => {
    if (closed) {
      return;
    }
    if (pending.length >= MAX_PENDING_RECORDS) {
      dropped += 1;
      scheduleFlush(0);
      return;
    }
    pending.push(record);
    scheduleFlush(
      pending.length === MAX_PENDING_RECORDS ? 0 : FLUSH_INTERVAL_MS,
    );
  };

  const close = async (finalRecord: unknown): Promise<void> => {
    if (closed) {
      return;
    }
    pending.push(finalRecord);
    closed = true;
    const drain = async (): Promise<void> => {
      await flush();
      if (writeInFlight !== undefined || pending.length > 0 || dropped > 0) {
        await drain();
      }
    };
    await drain();
  };

  return { close, write };
};
