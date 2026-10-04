import * as Cause from "effect/Cause";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { layer as desktopEnvironmentLayer } from "../DesktopEnvironment";
import {
  DesktopObservability,
  layer as desktopObservabilityLayer,
} from "./DesktopObservability";

const fixtureDirectories = new Set<string>();

const makeFixture = async (): Promise<string> => {
  const path = await fs.mkdtemp(join(tmpdir(), "lucent-observability-"));
  fixtureDirectories.add(path);
  return path;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw cause;
  }
};

const readRecords = async (path: string): Promise<unknown[]> =>
  (await fs.readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const makeLayer = (appDataDir: string, debug: boolean) =>
  desktopObservabilityLayer.pipe(
    Layer.provide(
      desktopEnvironmentLayer({
        appDataDir,
        assetsDir: join(appDataDir, "assets"),
        debug,
        isDev: false,
        platform: process.platform,
        workspaceDir: join(appDataDir, "workspace"),
      }),
    ),
  );

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    [...fixtureDirectories].map((path) =>
      fs.rm(path, { recursive: true, force: true }),
    ),
  );
  fixtureDirectories.clear();
});

describe("DesktopObservability", () => {
  it.effect("retains both operation and cleanup failures in the log file", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const exit = yield* Effect.fail(new Error("Operation failed")).pipe(
        Effect.ensuring(Effect.die(new Error("Cleanup failed"))),
        Effect.exit,
      );
      if (!Exit.isFailure(exit)) throw new Error("Expected operation failure");

      yield* Effect.logError("Runtime failed", exit.cause).pipe(
        Effect.provide(makeLayer(root, false)),
      );

      const records = yield* Effect.promise(() =>
        fs.readFile(join(root, "logs", "lucent.log"), "utf8"),
      );
      expect(records).toContain("Operation failed");
      expect(records).toContain("Cleanup failed");
    }),
  );

  it.effect("queues every log level and drains it in order on shutdown", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      const root = yield* Effect.promise(makeFixture);
      const logFilePath = join(root, "logs", "lucent.log");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const observability = yield* DesktopObservability;

          yield* Effect.logInfo("info").pipe(
            Effect.annotateLogs({ component: "test" }),
          );
          yield* Effect.logWarning("warn").pipe(
            Effect.annotateLogs({ component: "test", data: { attempt: 1 } }),
          );
          yield* Effect.logDebug("debug").pipe(
            Effect.annotateLogs({ component: "test" }),
          );
          yield* Effect.logError("error", Cause.fail(new Error("boom"))).pipe(
            Effect.annotateLogs({ component: "test" }),
          );
          observability.recordUnsafe({
            component: "renderer",
            event: "console",
            data: { message: "hello", rendererId: 1 },
          });
          yield* observability.record({
            component: "test",
            event: "diagnostic",
          });

          expect(yield* Effect.promise(() => fileExists(logFilePath))).toBe(
            false,
          );
        }).pipe(Effect.provide(makeLayer(root, false))),
      );

      expect(
        yield* Effect.promise(() => readRecords(logFilePath)),
      ).toMatchObject([
        { component: "test", level: "info", message: "info" },
        {
          component: "test",
          data: { attempt: 1 },
          level: "warn",
          message: "warn",
        },
        { component: "test", level: "debug", message: "debug" },
        {
          component: "test",
          error: [{ message: "boom", name: "Error" }],
          level: "error",
          message: "error",
        },
      ]);
    }),
  );

  it.effect(
    "captures service startup, native callbacks, spans, and shutdown",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(makeFixture);
        class Callback extends Context.Service<Callback, () => Promise<void>>()(
          "test/Callback",
        ) {}
        const callbackLayer = Layer.effect(
          Callback,
          Effect.gen(function* () {
            yield* Effect.logInfo("initialized");
            const context = yield* Effect.context<never>();
            yield* Effect.addFinalizer(() => Effect.logInfo("released"));
            return () =>
              Effect.runPromiseWith(context)(
                Effect.logWarning("callback").pipe(
                  Effect.annotateLogs({ requestId: "request-1" }),
                  Effect.withSpan("callback-span"),
                ),
              );
          }),
        ).pipe(Layer.provideMerge(makeLayer(root, false)));

        yield* Effect.gen(function* () {
          const callback = yield* Callback;
          yield* Effect.promise(callback);
        }).pipe(Effect.provide(callbackLayer));

        expect(
          yield* Effect.promise(() =>
            readRecords(join(root, "logs", "lucent.log")),
          ),
        ).toMatchObject([
          { level: "info", component: "effect", message: "initialized" },
          {
            level: "warn",
            message: "callback",
            annotations: { requestId: "request-1" },
            traceId: expect.any(String),
            spanId: expect.any(String),
          },
          { level: "info", message: "released" },
        ]);
      }),
  );

  it.effect("keeps diagnostic recording debug-only", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      const root = yield* Effect.promise(makeFixture);
      const logFilePath = join(root, "logs", "lucent.log");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const observability = yield* DesktopObservability;
          observability.recordUnsafe({
            component: "renderer",
            event: "console",
            data: { message: "hello", rendererId: 1 },
          });
          yield* observability.record({
            component: "test",
            event: "diagnostic",
          });

          expect(yield* Effect.promise(() => fileExists(logFilePath))).toBe(
            false,
          );
        }).pipe(Effect.provide(makeLayer(root, true))),
      );

      expect(
        yield* Effect.promise(() => readRecords(logFilePath)),
      ).toMatchObject([
        { event: "recording.started" },
        {
          component: "renderer",
          data: { message: "hello", rendererId: 1 },
          event: "console",
        },
        { event: "diagnostic" },
        { event: "recording.stopped" },
      ]);
    }),
  );
});
