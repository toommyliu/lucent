import { promises as fs } from "fs";
import { join } from "path";
import { BrowserWindow, app, type WebContents } from "electron";
import { Data, Effect, Layer, ServiceMap } from "effect";
import {
  formatErrorInfo,
  isObservabilityConsoleMessageData,
  makeRecordLine,
  normalizeObservabilityInput,
  sanitizeLogValue,
  type ObservabilityInput,
  type ObservabilityConsoleMessageData,
  type ObservabilityLevel,
  type ObservabilityRecord,
  type ObservabilitySnapshot,
  type ObservabilitySource,
} from "../../shared/observability";
import { makeRandomId } from "../../shared/random-id";
import { roundTimingMs, timingNow } from "../timing";
import { DesktopEnvironment } from "./DesktopEnvironment";

const MAX_LOG_BYTES = 20 * 1024 * 1024;
const MAX_ROTATED_FILES = 5;
const MAX_RECORDS = 2_000;
const RENDERER_CONSOLE_ECHO_SUPPRESSION_MS = 1_500;

export class ObservabilityWriteError extends Data.TaggedError(
  "ObservabilityWriteError",
)<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export interface DesktopObservabilityShape {
  readonly runId: string;
  readonly logPath: string;
  readonly write: (
    input: ObservabilityInput,
  ) => Effect.Effect<ObservabilityRecord>;
  readonly debug: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<ObservabilityRecord>;
  readonly info: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<ObservabilityRecord>;
  readonly warn: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<ObservabilityRecord>;
  readonly error: (
    component: string,
    message: string,
    error?: unknown,
    data?: unknown,
  ) => Effect.Effect<ObservabilityRecord>;
  readonly snapshot: Effect.Effect<ObservabilitySnapshot>;
  readonly subscribe: (
    listener: (record: ObservabilityRecord) => void,
  ) => Effect.Effect<() => void>;
  readonly installProcessHooks: Effect.Effect<void>;
  readonly observeWindow: (
    window: BrowserWindow,
    options?: {
      readonly source?: ObservabilitySource;
      readonly component?: string;
    },
  ) => Effect.Effect<void>;
}

export class DesktopObservability extends ServiceMap.Service<
  DesktopObservability,
  DesktopObservabilityShape
>()("main/DesktopObservability") {}

const rotatedLogPath = (path: string, index: number): string =>
  `${path}.${index}`;

const isMissingFileError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const sendToOpenDevConsole = (
  record: ObservabilityRecord,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const stream =
      record.level === "error" || record.level === "warn"
        ? process.stderr
        : process.stdout;
    stream.write(`[${record.source}:${record.component}] ${record.message}\n`);
  });

const mapElectronConsoleLevel = (
  level: number,
): ObservabilityConsoleMessageData["consoleLevel"] =>
  level >= 3 ? "error" : level === 2 ? "warn" : level === 1 ? "info" : "debug";

const rendererConsoleEchoKey = (
  component: string,
  level: ObservabilityLevel,
  message: string,
): string => `${component}\u0000${level}\u0000${message}`;

export const makeObservability = (
  logDir: string,
  options: {
    readonly runId?: string;
    readonly now?: () => Date;
  } = {},
): DesktopObservabilityShape => {
  const runId = options.runId ?? makeRandomId();
  const now = options.now ?? (() => new Date());
  const logPath = join(logDir, "logs.ndjson");
  const records: ObservabilityRecord[] = [];
  const listeners = new Set<(record: ObservabilityRecord) => void>();
  const rendererConsoleEchoes = new Map<string, number>();
  let nextRecordId = 0;
  let writeChain: Promise<void> = Promise.resolve();
  let processHooksInstalled = false;

  const pruneRendererConsoleEchoes = (timestamp: number): void => {
    for (const [key, seenAt] of rendererConsoleEchoes) {
      if (timestamp - seenAt > RENDERER_CONSOLE_ECHO_SUPPRESSION_MS) {
        rendererConsoleEchoes.delete(key);
      }
    }
  };

  const rememberRendererConsoleEcho = (record: ObservabilityRecord): void => {
    if (!isObservabilityConsoleMessageData(record.data)) {
      return;
    }

    if (
      record.data.capturedBy !== "renderer-console" ||
      record.data.nativeMessage === undefined
    ) {
      return;
    }

    const timestamp = Date.now();
    pruneRendererConsoleEchoes(timestamp);
    rendererConsoleEchoes.set(
      rendererConsoleEchoKey(
        record.component,
        record.level,
        record.data.nativeMessage,
      ),
      timestamp,
    );
  };

  const shouldSuppressRendererConsoleEcho = (
    component: string,
    level: ObservabilityLevel,
    message: string,
  ): boolean => {
    const timestamp = Date.now();
    pruneRendererConsoleEchoes(timestamp);
    const seenAt = rendererConsoleEchoes.get(
      rendererConsoleEchoKey(component, level, message),
    );
    return (
      seenAt !== undefined &&
      timestamp - seenAt <= RENDERER_CONSOLE_ECHO_SUPPRESSION_MS
    );
  };

  const rotateIfNeeded = async (): Promise<void> => {
    let currentSize = 0;
    try {
      currentSize = (await fs.stat(logPath)).size;
    } catch (cause) {
      if (isMissingFileError(cause)) {
        return;
      }
      throw cause;
    }

    if (currentSize < MAX_LOG_BYTES) {
      return;
    }

    for (let index = MAX_ROTATED_FILES - 1; index >= 1; index--) {
      try {
        await fs.rename(
          rotatedLogPath(logPath, index),
          rotatedLogPath(logPath, index + 1),
        );
      } catch (cause) {
        if (!isMissingFileError(cause)) {
          throw cause;
        }
      }
    }

    try {
      await fs.rename(logPath, rotatedLogPath(logPath, 1));
    } catch (cause) {
      if (!isMissingFileError(cause)) {
        throw cause;
      }
    }
  };

  const writeRecord = (
    record: ObservabilityRecord,
  ): Effect.Effect<ObservabilityRecord, ObservabilityWriteError> =>
    Effect.tryPromise({
      try: async () => {
        records.push(record);
        if (records.length > MAX_RECORDS) {
          records.splice(0, records.length - MAX_RECORDS);
        }

        for (const listener of listeners) {
          try {
            listener(record);
          } catch {
            // Observability subscribers are auxiliary sinks and must not affect
            // the primary in-memory/file logging path.
          }
        }

        writeChain = writeChain
          .catch(() => undefined)
          .then(async () => {
            await fs.mkdir(logDir, { recursive: true });
            await rotateIfNeeded();
            await fs.writeFile(logPath, makeRecordLine(record), {
              encoding: "utf8",
              flag: "a",
            });
          });
        await writeChain;
        return record;
      },
      catch: (cause) => new ObservabilityWriteError({ path: logPath, cause }),
    });

  const write: DesktopObservabilityShape["write"] = (input) => {
    const normalized = normalizeObservabilityInput(input);
    const record: ObservabilityRecord = {
      id: nextRecordId++,
      runId,
      timestamp: now().toISOString(),
      level: normalized.level ?? "info",
      source: normalized.source ?? "main",
      component: normalized.component ?? "main",
      message: normalized.message,
      ...(normalized.data === undefined
        ? {}
        : { data: sanitizeLogValue(normalized.data) }),
      ...(normalized.error === undefined
        ? {}
        : { error: formatErrorInfo(normalized.error) }),
    };
    rememberRendererConsoleEcho(record);

    return writeRecord(record).pipe(
      Effect.catchCause(() =>
        sendToOpenDevConsole({
          ...record,
          level: "error",
          message: "Failed to write observability record",
        }).pipe(Effect.as(record)),
      ),
    );
  };

  const log =
    (level: ObservabilityLevel) =>
    (
      component: string,
      message: string,
      data?: unknown,
    ): Effect.Effect<ObservabilityRecord> =>
      write({
        level,
        source: "main",
        component,
        message,
        ...(data === undefined ? {} : { data }),
      });

  const error: DesktopObservabilityShape["error"] = (
    component,
    message,
    error,
    data,
  ) =>
    write({
      level: "error",
      source: "main",
      component,
      message,
      ...(data === undefined ? {} : { data }),
      ...(error === undefined ? {} : { error }),
    });

  const subscribe: DesktopObservabilityShape["subscribe"] = (listener) =>
    Effect.sync(() => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });

  const observeWindow: DesktopObservabilityShape["observeWindow"] = (
    window,
    options,
  ) =>
    Effect.sync(() => {
      const component = options?.component ?? `window:${window.id}`;
      const source = options?.source ?? "electron";
      const webContents = window.webContents as WebContents;
      const observedAt = timingNow();

      const writeLifecycleEvent = (
        message: string,
        data?: Record<string, unknown>,
      ): void => {
        void Effect.runPromise(
          write({
            level: "info",
            source,
            component,
            message,
            data: {
              windowId: window.id,
              webContentsId: webContents.id,
              sinceObservedMs: roundTimingMs(timingNow() - observedAt),
              visible: window.isVisible(),
              minimized: window.isMinimized(),
              ...data,
            },
          }),
        );
      };

      writeLifecycleEvent("Window observed");

      webContents.once("dom-ready", () => {
        writeLifecycleEvent("Window DOM ready");
      });

      webContents.once("did-finish-load", () => {
        writeLifecycleEvent("Window load finished");
      });

      window.once("ready-to-show", () => {
        writeLifecycleEvent("Window ready to show");
      });

      window.once("show", () => {
        writeLifecycleEvent("Window shown");
      });

      webContents.on(
        "console-message",
        (_event, level, message, line, sourceId) => {
          const logLevel = mapElectronConsoleLevel(level);
          if (shouldSuppressRendererConsoleEcho(component, logLevel, message)) {
            return;
          }

          const data: ObservabilityConsoleMessageData = {
            kind: "console-message",
            consoleLevel: logLevel,
            electronLevel: level,
            line,
            sourceId,
            capturedBy: "electron",
          };
          void Effect.runPromise(
            write({
              level: logLevel,
              source,
              component,
              message,
              data,
            }),
          );
        },
      );

      webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL) => {
          void Effect.runPromise(
            write({
              level: "error",
              source,
              component,
              message: "Web contents failed to load",
              data: { errorCode, errorDescription, validatedURL },
            }),
          );
        },
      );

      webContents.on("render-process-gone", (_event, details) => {
        void Effect.runPromise(
          write({
            level: "error",
            source,
            component,
            message: "Render process exited",
            data: details,
          }),
        );
      });

      window.on("unresponsive", () => {
        void Effect.runPromise(
          write({
            level: "warn",
            source,
            component,
            message: "Window became unresponsive",
          }),
        );
      });

      window.on("responsive", () => {
        void Effect.runPromise(
          write({
            level: "info",
            source,
            component,
            message: "Window became responsive",
          }),
        );
      });
    });

  const installProcessHooks: DesktopObservabilityShape["installProcessHooks"] =
    Effect.sync(() => {
      if (processHooksInstalled) {
        return;
      }

      processHooksInstalled = true;

      process.on("uncaughtException", (cause) => {
        void Effect.runPromise(
          write({
            level: "error",
            source: "process",
            component: "process",
            message: "Uncaught exception",
            error: cause,
          }),
        );
      });

      process.on("unhandledRejection", (cause) => {
        void Effect.runPromise(
          write({
            level: "error",
            source: "process",
            component: "process",
            message: "Unhandled rejection",
            error: cause,
          }),
        );
      });

      app.on("render-process-gone", (_event, webContents, details) => {
        void Effect.runPromise(
          write({
            level: "error",
            source: "electron",
            component: `webContents:${webContents.id}`,
            message: "Render process gone",
            data: details,
          }),
        );
      });

      app.on("child-process-gone", (_event, details) => {
        void Effect.runPromise(
          write({
            level: "error",
            source: "electron",
            component: "child-process",
            message: "Child process gone",
            data: details,
          }),
        );
      });
    });

  return {
    runId,
    logPath,
    write,
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error,
    snapshot: Effect.sync(() => ({
      runId,
      logPath,
      records: [...records],
    })),
    subscribe,
    installProcessHooks,
    observeWindow,
  };
};

export const DesktopObservabilityLive = Layer.effect(DesktopObservability)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    return makeObservability(env.logsDir);
  }),
);
