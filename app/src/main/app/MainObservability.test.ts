import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  app: {
    on: vi.fn(),
  },
}));

import { makeObservability } from "./MainObservability";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

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

  it("writes sanitized NDJSON records and keeps an in-memory snapshot", async () => {
    const observability = makeObservability(testDir, {
      runId: "run-1",
      now: () => new Date("2026-05-22T12:00:00.000Z"),
    });

    const record = await run(
      observability.write({
        level: "info",
        source: "renderer",
        component: "settings",
        message: "Saved settings",
        data: {
          password: "secret",
          count: 1,
        },
      }),
    );

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

    await expect(readFile(observability.logPath, "utf8")).resolves.toBe(
      `${JSON.stringify(record)}\n`,
    );
    await expect(run(observability.snapshot)).resolves.toMatchObject({
      runId: "run-1",
      logPath: observability.logPath,
      records: [record],
    });
  });

  it("falls back to console output instead of failing caller writes", async () => {
    const filePath = join(testDir, "not-a-directory");
    await writeFile(filePath, "", "utf8");
    const observability = makeObservability(join(filePath, "child"), {
      runId: "run-1",
      now: () => new Date("2026-05-22T12:00:00.000Z"),
    });

    await expect(
      run(
        observability.error("startup", "Unable to write log", new Error("io")),
      ),
    ).resolves.toMatchObject({
      level: "error",
      message: "Unable to write log",
    });
  });

  it("records window lifecycle timing points", async () => {
    const observability = makeObservability(testDir, {
      runId: "run-1",
      now: () => new Date("2026-05-22T12:00:00.000Z"),
    });
    const window = new FakeObservedWindow();

    await run(
      observability.observeWindow(window as unknown as BrowserWindow, {
        source: "game",
        component: "game-window:9",
      }),
    );

    window.webContents.emit("dom-ready");
    window.webContents.emit("did-finish-load");
    window.emit("ready-to-show");
    window.visible = true;
    window.emit("show");

    await vi.waitFor(async () => {
      const snapshot = await run(observability.snapshot);
      expect(snapshot.records.map((record) => record.message)).toEqual([
        "Window observed",
        "Window DOM ready",
        "Window load finished",
        "Window ready to show",
        "Window shown",
      ]);
    });

    const snapshot = await run(observability.snapshot);
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
  });
});
