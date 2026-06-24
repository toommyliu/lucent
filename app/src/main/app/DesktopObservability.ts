import { promises as fs } from "fs";
import { Context, Effect, Layer } from "effect";

import { DesktopEnvironment } from "./DesktopEnvironment";

export type ObservabilityLevel = "debug" | "error" | "info" | "warn";

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
  readonly installProcessHooks: Effect.Effect<void>;
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

const errorDetails = (cause: unknown): unknown => {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
    };
  }

  return cause;
};

const serialize = (record: unknown): Effect.Effect<string> =>
  Effect.sync(() => {
    try {
      return `${JSON.stringify(record)}\n`;
    } catch {
      return `${JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        component: "observability",
        message: "Failed to serialize log record",
      })}\n`;
    }
  });

const makeDesktopObservability = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;

  const writeRecord = (
    level: ObservabilityLevel,
    component: string,
    message: string,
    data?: unknown,
    cause?: unknown,
  ) =>
    serialize({
      at: new Date().toISOString(),
      level,
      component,
      message,
      ...(data === undefined ? {} : { data }),
      ...(cause === undefined ? {} : { error: errorDetails(cause) }),
    }).pipe(
      Effect.flatMap((source) =>
        Effect.tryPromise({
          try: async () => {
            await fs.mkdir(env.logsDir, { recursive: true });
            await fs.appendFile(env.logFilePath, source, "utf8");
          },
          catch: () => undefined,
        }),
      ),
      Effect.catch(() => Effect.void),
    );

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

  const installProcessHooks = Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    yield* Effect.sync(() => {
      process.on("uncaughtException", (cause) => {
        void runPromise(error("process", "Uncaught exception", cause)).catch(
          () => undefined,
        );
      });
      process.on("unhandledRejection", (cause) => {
        void runPromise(error("process", "Unhandled rejection", cause)).catch(
          () => undefined,
        );
      });
    });
  });

  return DesktopObservability.of({
    debug,
    error,
    info,
    installProcessHooks,
    warn,
  });
});

export const layer = Layer.effect(
  DesktopObservability,
  makeDesktopObservability,
);
