import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  app: {
    on: vi.fn(),
  },
}));

import { makeObservability } from "./MainObservability";

class FakeObservedWindow extends EventEmitter {
  public readonly id = 9;
  public visible = false;
  public minimized = false;
  public readonly webContents = Object.assign(new EventEmitter(), {
    id: 10,
  });

  public isVisible(): boolean {
    return this.visible;
  }

  public isMinimized(): boolean {
    return this.minimized;
  }
}

describe("main observability", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "lucent-observability-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it.effect(
    "writes sanitized NDJSON records and keeps an in-memory snapshot",
    () =>
      Effect.gen(function* () {
        const observability = makeObservability(testDir, {
          runId: "run-1",
          now: () => new Date("2026-05-22T12:00:00.000Z"),
        });

        const record = yield* observability.write({
          level: "info",
          source: "renderer",
          component: "settings",
          message: "Saved settings",
          data: {
            password: "secret",
            count: 1,
          },
        });

        expect(record).toMatchObject({
          id: 0,
          runId: "run-1",
          timestamp: "2026-05-22T12:00:00.000Z",
          level: "info",
          source: "renderer",
          component: "settings",
          message: "Saved settings",
          data: {
            password: "[REDACTED]",
            count: 1,
          },
        });

        const log = yield* Effect.promise(() =>
          readFile(observability.logPath, "utf8"),
        );
        expect(log).toBe(`${JSON.stringify(record)}\n`);

        const snapshot = yield* observability.snapshot;
        expect(snapshot).toMatchObject({
          runId: "run-1",
          logPath: observability.logPath,
          records: [record],
        });
      }),
  );

  it.effect(
    "falls back to console output instead of failing caller writes",
    () =>
      Effect.gen(function* () {
        const filePath = join(testDir, "not-a-directory");
        yield* Effect.promise(() => writeFile(filePath, "", "utf8"));
        const observability = makeObservability(join(filePath, "child"), {
          runId: "run-1",
          now: () => new Date("2026-05-22T12:00:00.000Z"),
        });

        const record = yield* observability.error(
          "startup",
          "Unable to write log",
          new Error("io"),
        );
        expect(record).toMatchObject({
          level: "error",
          message: "Unable to write log",
        });
      }),
  );

  it.effect("records window lifecycle timing points", () =>
    Effect.gen(function* () {
      const observability = makeObservability(testDir, {
        runId: "run-1",
        now: () => new Date("2026-05-22T12:00:00.000Z"),
      });
      const window = new FakeObservedWindow();

      yield* observability.observeWindow(window as unknown as BrowserWindow, {
        source: "game",
        component: "game-window:9",
      });

      window.webContents.emit("dom-ready");
      window.webContents.emit("did-finish-load");
      window.emit("ready-to-show");
      window.visible = true;
      window.emit("show");

      yield* Effect.promise(() =>
        vi.waitFor(async () => {
          const log = await readFile(observability.logPath, "utf8");
          const messages = log
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { readonly message: string })
            .map((record) => record.message);
          expect(messages).toEqual([
            "Window observed",
            "Window DOM ready",
            "Window load finished",
            "Window ready to show",
            "Window shown",
          ]);
        }),
      );

      const snapshot = yield* observability.snapshot;
      expect(snapshot.records.at(-1)).toMatchObject({
        source: "game",
        component: "game-window:9",
        data: {
          windowId: 9,
          webContentsId: 10,
          visible: true,
          minimized: false,
        },
      });
    }),
  );
});
