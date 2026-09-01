import type { EventEmitter } from "events";
import { join } from "path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import {
  DesktopTraceSpanSchema,
  type DesktopTraceResponse,
  type DesktopTraceSpan,
} from "../../../shared/ipc";
import { DesktopEnvironment } from "../DesktopEnvironment";
import {
  desktopLogErrorDetails,
  makeBufferedDesktopLogWriter,
} from "./DesktopLogWriter";
import { makeDesktopTraceBuffer } from "./DesktopTraceBuffer";

export type ObservabilityLevel = "debug" | "error" | "info" | "warn";

export interface DesktopDiagnosticRecord {
  readonly component: string;
  readonly event: string;
  readonly data?: unknown;
  readonly cause?: unknown;
}

export interface DesktopObservabilityShape {
  readonly debug: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<void>;
  readonly error: (
    component: string,
    message: string,
    cause?: unknown,
    data?: unknown,
  ) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void>;
  readonly info: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<void>;
  readonly installProcessHooks: Effect.Effect<void, never, Scope.Scope>;
  readonly logFilePath: string;
  readonly record: (record: DesktopDiagnosticRecord) => Effect.Effect<void>;
  readonly recordUnsafe: (record: DesktopDiagnosticRecord) => void;
  readonly subscribeTrace: (
    listener: (span: DesktopTraceSpan) => void,
  ) => () => void;
  readonly traceSnapshot: () => DesktopTraceResponse;
  readonly warn: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<void>;
}

export class DesktopObservability extends Context.Service<
  DesktopObservability,
  DesktopObservabilityShape
>()("lucent/desktop/app/observability/DesktopObservability") {}

const makeDesktopObservability = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const logsDir = join(env.appDataDir, "logs");
  const logFilePath = join(logsDir, "lucent.log");
  const bufferedWriter = makeBufferedDesktopLogWriter(logsDir, logFilePath);
  const diagnosticRecordingEnabled = env.debug === true;
  const recordingStartedAt = diagnosticRecordingEnabled
    ? new Date().toISOString()
    : null;
  const traceBuffer = makeDesktopTraceBuffer(recordingStartedAt);
  const traceListeners = new Set<(span: DesktopTraceSpan) => void>();
  const isDesktopTraceSpan = Schema.is(DesktopTraceSpanSchema);

  const writeRecord = (
    level: ObservabilityLevel,
    component: string,
    message: string,
    data?: unknown,
    cause?: unknown,
    event?: string,
  ) => {
    const record = {
      at: new Date().toISOString(),
      level,
      component,
      message,
      ...(event === undefined ? {} : { event }),
      ...(data === undefined ? {} : { data }),
      ...(cause === undefined ? {} : { error: desktopLogErrorDetails(cause) }),
    };
    return Effect.sync(() => bufferedWriter.write(record));
  };

  const info: DesktopObservabilityShape["info"] = (component, message, data) =>
    writeRecord("info", component, message, data);

  const warn: DesktopObservabilityShape["warn"] = (component, message, data) =>
    writeRecord("warn", component, message, data);

  const debug: DesktopObservabilityShape["debug"] = (
    component,
    message,
    data,
  ) => writeRecord("debug", component, message, data);

  const error: DesktopObservabilityShape["error"] = (
    component,
    message,
    cause,
    data,
  ) => writeRecord("error", component, message, data, cause);

  const flush: DesktopObservabilityShape["flush"] = Effect.promise(() =>
    bufferedWriter.flush(),
  );

  const recordUnsafe: DesktopObservabilityShape["recordUnsafe"] =
    diagnosticRecordingEnabled === false
      ? () => undefined
      : (diagnostic) => {
          bufferedWriter.write({
            at: new Date().toISOString(),
            level: "debug",
            component: diagnostic.component,
            message: diagnostic.event,
            event: diagnostic.event,
            ...(diagnostic.data === undefined ? {} : { data: diagnostic.data }),
            ...(diagnostic.cause === undefined
              ? {}
              : { error: desktopLogErrorDetails(diagnostic.cause) }),
          });
          if (
            diagnostic.component === "trace" &&
            diagnostic.event === "span.completed" &&
            isDesktopTraceSpan(diagnostic.data)
          ) {
            traceBuffer.append(diagnostic.data);
            for (const listener of traceListeners) {
              try {
                listener(diagnostic.data);
              } catch {}
            }
          }
        };

  const subscribeTrace: DesktopObservabilityShape["subscribeTrace"] = (
    listener,
  ) => {
    traceListeners.add(listener);
    return () => {
      traceListeners.delete(listener);
    };
  };

  const record: DesktopObservabilityShape["record"] =
    diagnosticRecordingEnabled === false
      ? () => Effect.void
      : (diagnostic) => Effect.sync(() => recordUnsafe(diagnostic));

  const installProcessHooks = Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const handleUncaughtException = (cause: unknown): void => {
      void runPromise(error("process", "Uncaught exception", cause)).catch(
        () => undefined,
      );
    };
    const handleUnhandledRejection = (cause: unknown): void => {
      void runPromise(error("process", "Unhandled rejection", cause)).catch(
        () => undefined,
      );
    };

    yield* Effect.sync(() => {
      process.on("uncaughtException", handleUncaughtException);
      process.on("unhandledRejection", handleUnhandledRejection);
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        (process as EventEmitter).removeListener(
          "uncaughtException",
          handleUncaughtException,
        );
        (process as EventEmitter).removeListener(
          "unhandledRejection",
          handleUnhandledRejection,
        );
      }),
    );
  });

  if (recordingStartedAt !== null) {
    bufferedWriter.write({
      at: recordingStartedAt,
      level: "debug",
      component: "startup",
      message: "Diagnostic recording started",
      event: "recording.started",
      data: {
        architecture: process.arch,
        pid: process.pid,
        platform: env.platform,
        runtimeVersions: {
          chrome: process.versions.chrome ?? "unknown",
          electron: process.versions.electron ?? "unknown",
          node: process.versions.node,
        },
      },
    });
  }

  yield* Effect.addFinalizer(() =>
    Effect.promise(() =>
      bufferedWriter.close(
        diagnosticRecordingEnabled
          ? {
              at: new Date().toISOString(),
              level: "debug",
              component: "startup",
              message: "Diagnostic recording stopped",
              event: "recording.stopped",
              data: { pid: process.pid },
            }
          : undefined,
      ),
    ),
  );

  return DesktopObservability.of({
    debug,
    error,
    flush,
    info,
    installProcessHooks,
    logFilePath,
    record,
    recordUnsafe,
    subscribeTrace,
    traceSnapshot: traceBuffer.snapshot,
    warn,
  });
});

export const layer = Layer.effect(
  DesktopObservability,
  makeDesktopObservability,
);
