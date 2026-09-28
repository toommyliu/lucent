import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import { ElectronApp } from "../../electron/ElectronApp";
import { ElectronChromiumPerformance } from "../../electron/ElectronChromiumPerformance";
import { DesktopWindows } from "../../window/DesktopWindows";
import { layer as environmentLayer } from "../DesktopEnvironment";
import {
  DesktopPerformanceTrace,
  layer as traceLayer,
} from "./DesktopPerformanceTrace";
import {
  DesktopChromiumPerformanceRecording,
  layer as chromiumLayer,
} from "./DesktopChromiumPerformanceRecording";

const fixture = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "lucent-recordings-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
);
const environment = (root: string) =>
  environmentLayer({
    appDataDir: root,
    assetsDir: join(root, "assets"),
    workspaceDir: join(root, "workspace"),
    isDev: false,
    platform: process.platform,
  });

describe("recording lifetimes", () => {
  it.effect(
    "serializes trace starts and stops sampling on stop or service shutdown",
    () =>
      Effect.gen(function* () {
        const root = yield* fixture;
        let samples = 0;
        const layer = traceLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              environment(root),
              Layer.mock(ElectronApp, {
                getVersion: Effect.succeed("1.0.0"),
                getAppMetrics: Effect.sync(() => {
                  samples += 1;
                  return [];
                }),
              }),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const trace = yield* DesktopPerformanceTrace;
          const starts = yield* Effect.all(
            [trace.start.pipe(Effect.result), trace.start.pipe(Effect.result)],
            { concurrency: "unbounded" },
          );
          expect(starts.filter(Result.isSuccess)).toHaveLength(1);
          expect(starts.filter(Result.isFailure)).toHaveLength(1);
          yield* TestClock.adjust(1000);
          const saved = yield* trace.stop;
          expect(saved).toMatchObject({ durationMs: 1000, sampleCount: 1 });
          expect(
            JSON.parse(
              yield* Effect.promise(() => readFile(saved!.filePath, "utf8")),
            ),
          ).toMatchObject({
            lucent: {
              samples: [{ elapsedMs: 1000, processes: [] }],
              summary: { sampleCount: 1 },
            },
          });
          expect(samples).toBe(2);
          yield* TestClock.adjust(5000);
          expect(samples).toBe(2);
          yield* trace.start;
        }).pipe(Effect.provide(layer));
        const before = samples;
        yield* TestClock.adjust(5000);
        expect(samples).toBe(before);
      }),
  );

  it.effect(
    "interrupts pending Chromium samples before releasing debuggers and saving",
    () =>
      Effect.gen(function* () {
        const root = yield* fixture;
        const events: string[] = [];
        let resources = 0;
        const layer = chromiumLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              environment(root),
              Layer.mock(ElectronApp, {
                getVersion: Effect.succeed("1.0.0"),
                getAppMetrics: Effect.sync(() => {
                  resources += 1;
                  return [];
                }),
              }),
              Layer.mock(DesktopWindows, {
                getRendererKind: () => Effect.succeed("game"),
                getRendererGeneration: () => Effect.succeed(1),
                getOwnerRendererId: () => Effect.succeed(null),
              }),
              Layer.mock(ElectronChromiumPerformance, {
                getCategories: Effect.succeed([]),
                getMainHeapUsage: Effect.succeed({
                  externalBytes: 1,
                  heapTotalBytes: 2,
                  heapUsedBytes: 1,
                  rssBytes: 3,
                }),
                getRendererTargets: Effect.succeed([
                  { rendererId: 1, osProcessId: 2 },
                ]),
                getRendererHeapUsage: () =>
                  Effect.sync(() => {
                    events.push("sample:start");
                  }).pipe(
                    Effect.andThen(Effect.never),
                    Effect.onInterrupt(() =>
                      Effect.sync(() => {
                        events.push("sample:cancel");
                      }),
                    ),
                  ),
                startRecording: () => Effect.void,
                stopRecording: (path) => Effect.succeed(path),
                releaseRendererDebuggers: Effect.sync(() => {
                  events.push("debuggers:release");
                }),
              }),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const recording = yield* DesktopChromiumPerformanceRecording;
          yield* recording.start;
          yield* TestClock.adjust(2500);
          expect(events).toEqual(["sample:start"]);
          const saved = yield* recording.stop;
          expect(events).toEqual([
            "sample:start",
            "sample:cancel",
            "debuggers:release",
          ]);
          expect(saved).toMatchObject({
            durationMs: 2500,
            resourceSampleCount: 3,
            traceSegmentCount: 1,
            warningCount: 0,
          });
          expect(
            JSON.parse(
              yield* Effect.promise(() =>
                readFile(saved!.manifestPath, "utf8"),
              ),
            ),
          ).toMatchObject({
            status: "complete",
            warnings: [],
            trace: { segments: [{ reason: "stop", durationMs: 2500 }] },
          });
          yield* TestClock.adjust(10_000);
          expect(resources).toBe(4);
          expect(events).toHaveLength(3);
          yield* recording.start;
          yield* Effect.yieldNow;
        }).pipe(Effect.provide(layer));
        expect(events).toEqual([
          "sample:start",
          "sample:cancel",
          "debuggers:release",
          "sample:start",
          "sample:cancel",
          "debuggers:release",
        ]);
        const before = resources;
        yield* TestClock.adjust(10_000);
        expect(resources).toBe(before);
      }),
  );
});
