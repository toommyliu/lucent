import type { EventEmitter } from "events";
import { join } from "path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { DesktopEnvironment } from "./DesktopEnvironment";
import {
  appendDesktopLogRecord,
  desktopLogErrorDetails,
  makeBufferedDesktopLogWriter,
} from "./DesktopLogWriter";

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
  readonly info: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<void>;
  readonly installProcessHooks: Effect.Effect<void, never, Scope.Scope>;
  readonly logFilePath: string;
  readonly record: (record: DesktopDiagnosticRecord) => Effect.Effect<void>;
  readonly recordUnsafe: (record: DesktopDiagnosticRecord) => void;
  readonly subscribe: (
    listener: (record: DesktopDiagnosticRecord) => void,
  ) => () => void;
  readonly warn: (
    component: string,
    message: string,
    data?: unknown,
  ) => Effect.Effect<void>;
}

export class DesktopObservability extends Context.Service<
  DesktopObservability,
  DesktopObservabilityShape
>()("lucent/desktop/app/DesktopObservability") {}

const makeDesktopObservability = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const logsDir = join(env.appDataDir, "logs");
  const logFilePath = join(logsDir, "lucent.log");
  const bufferedWriter =
    env.debug === true
      ? makeBufferedDesktopLogWriter(logsDir, logFilePath)
      : undefined;
  const diagnosticListeners = new Set<
    (record: DesktopDiagnosticRecord) => void
  >();

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
    if (bufferedWriter !== undefined) {
      return Effect.sync(() => bufferedWriter.write(record));
    }

    return Effect.tryPromise({
      try: async () => {
        await appendDesktopLogRecord(logsDir, logFilePath, record);
      },
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.void));
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

  const recordUnsafe: DesktopObservabilityShape["recordUnsafe"] =
    bufferedWriter === undefined
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
          for (const listener of diagnosticListeners) {
            try {
              listener(diagnostic);
            } catch {}
          }
        };

  const subscribe: DesktopObservabilityShape["subscribe"] = (listener) => {
    diagnosticListeners.add(listener);
    return () => {
      diagnosticListeners.delete(listener);
    };
  };

  const record: DesktopObservabilityShape["record"] =
    bufferedWriter === undefined
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

  if (bufferedWriter !== undefined) {
    bufferedWriter.write({
      at: new Date().toISOString(),
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
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        bufferedWriter.close({
          at: new Date().toISOString(),
          level: "debug",
          component: "startup",
          message: "Diagnostic recording stopped",
          event: "recording.stopped",
          data: { pid: process.pid },
        }),
      ),
    );
  }

  return DesktopObservability.of({
    debug,
    error,
    info,
    installProcessHooks,
    logFilePath,
    record,
    recordUnsafe,
    subscribe,
    warn,
  });
});

export const layer = Layer.effect(
  DesktopObservability,
  makeDesktopObservability,
);
