import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, vi } from "vitest";

import type { DesktopTraceSpan } from "../../../shared/ipc";
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

const traceSpan = (): DesktopTraceSpan => ({
  attributes: {},
  durationMs: 1,
  endTimeUnixNano: "2",
  events: [],
  exit: { _tag: "Success" },
  kind: "internal",
  links: [],
  name: "test-span",
  sampled: true,
  source: "effect",
  spanId: "span-1",
  startTimeUnixNano: "1",
  traceId: "trace-1",
});

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
  it.effect("queues every log level and drains it in order on shutdown", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      const root = yield* Effect.promise(makeFixture);
      const logFilePath = join(root, "logs", "lucent.log");
      const span = traceSpan();
      const observedSpans: DesktopTraceSpan[] = [];

      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const observability = yield* DesktopObservability;
          const unsubscribe = observability.subscribeTrace((recordedSpan) => {
            observedSpans.push(recordedSpan);
          });

          yield* observability.info("test", "info");
          yield* observability.warn("test", "warn", { attempt: 1 });
          yield* observability.debug("test", "debug");
          yield* observability.error("test", "error", new Error("boom"));
          observability.recordUnsafe({
            component: "trace",
            event: "span.completed",
            data: span,
          });
          yield* observability.record({
            component: "test",
            event: "diagnostic",
          });
          unsubscribe();

          expect(yield* Effect.promise(() => fileExists(logFilePath))).toBe(
            false,
          );
          return observability.traceSnapshot();
        }).pipe(Effect.provide(makeLayer(root, false))),
      );

      expect(snapshot).toEqual({
        recordingStartedAt: null,
        spans: [],
        truncated: false,
      });
      expect(observedSpans).toEqual([]);
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
          error: { message: "boom", name: "Error" },
          level: "error",
          message: "error",
        },
      ]);
    }),
  );

  it.effect("keeps diagnostic recording and tracing debug-only", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      const root = yield* Effect.promise(makeFixture);
      const logFilePath = join(root, "logs", "lucent.log");
      const span = traceSpan();
      const observedSpans: DesktopTraceSpan[] = [];

      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const observability = yield* DesktopObservability;
          observability.subscribeTrace((recordedSpan) => {
            observedSpans.push(recordedSpan);
          });
          observability.recordUnsafe({
            component: "trace",
            event: "span.completed",
            data: span,
          });
          yield* observability.record({
            component: "test",
            event: "diagnostic",
          });

          expect(yield* Effect.promise(() => fileExists(logFilePath))).toBe(
            false,
          );
          return observability.traceSnapshot();
        }).pipe(Effect.provide(makeLayer(root, true))),
      );

      expect(snapshot).toEqual({
        recordingStartedAt: expect.any(String),
        spans: [span],
        truncated: false,
      });
      expect(observedSpans).toEqual([span]);
      expect(
        yield* Effect.promise(() => readRecords(logFilePath)),
      ).toMatchObject([
        { event: "recording.started" },
        { data: span, event: "span.completed" },
        { event: "diagnostic" },
        { event: "recording.stopped" },
      ]);
    }),
  );
});
