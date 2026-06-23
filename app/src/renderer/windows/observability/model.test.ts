import { describe, expect, it } from "@effect/vitest";
import type {
  ObservabilityLevel,
  ObservabilityRecord,
} from "../../../shared/observability";
import {
  allWindowsFilter,
  consoleRecordKey,
  excludeConsoleRecordKeys,
  exportConsoleRecords,
  filterConsoleRecords,
  formatConsoleRecordWindow,
  formatConsoleRecordWindowComponent,
  mergeConsoleRecords,
} from "./model";

const makeRecord = (
  id: number,
  input: Partial<ObservabilityRecord> = {},
): ObservabilityRecord => ({
  id,
  runId: "run-1",
  timestamp: "2026-05-22T12:00:00.000Z",
  level: "info",
  source: "game",
  component: "game-window:1",
  message: `record-${id}`,
  data: {
    kind: "console-message",
    consoleLevel: "info",
    electronLevel: 1,
    line: id,
    sourceId: "source.js",
  },
  ...input,
});

const levels = (
  values: readonly ObservabilityLevel[],
): ReadonlySet<ObservabilityLevel> => new Set(values);

describe("observability viewer model", () => {
  it("filters console records by level, window, and search text", () => {
    const records = [
      makeRecord(1, {
        level: "debug",
        message: "[script:farm.js] ready",
      }),
      makeRecord(2, {
        component: "game-window:2",
        level: "error",
        message: "bridge failed",
      }),
      makeRecord(3, {
        message: "Window observed",
        data: { windowId: 1 },
      }),
    ];

    expect(
      filterConsoleRecords(records, {
        levels: levels(["debug", "error"]),
        search: "farm",
        windowComponent: "game-window:1",
      }),
    ).toEqual([records[0]]);
  });

  it("formats and searches account metadata when console records include it", () => {
    const record = makeRecord(1, {
      data: {
        kind: "console-message",
        consoleLevel: "info",
        electronLevel: 1,
        line: 1,
        sourceId: "source.js",
        account: { label: "Main Farmer", username: "hero" },
      },
    });

    expect(formatConsoleRecordWindow(record)).toBe(
      "game-window:1 - Main Farmer (hero)",
    );
    expect(formatConsoleRecordWindowComponent("game-window:1", [record])).toBe(
      "game-window:1 - Main Farmer (hero)",
    );
    expect(
      formatConsoleRecordWindowComponent("game-window:1", [record], {
        label: "Alt",
        username: "alt",
      }),
    ).toBe("game-window:1 - Alt (alt)");
    expect(
      formatConsoleRecordWindowComponent("game-window:1", [
        record,
        makeRecord(2),
        makeRecord(3, {
          data: {
            kind: "console-message",
            consoleLevel: "info",
            electronLevel: 1,
            line: 3,
            sourceId: "source.js",
            account: { label: "Alt", username: "alt" },
          },
        }),
      ]),
    ).toBe("game-window:1 - Alt (alt)");
    expect(
      filterConsoleRecords([record], {
        accountsByComponent: new Map([
          ["game-window:1", { label: "Alt", username: "alt" }],
        ]),
        levels: levels(["info"]),
        search: "alt",
        windowComponent: allWindowsFilter,
      }),
    ).toEqual([record]);

    expect(
      formatConsoleRecordWindow(
        makeRecord(2, {
          data: {
            kind: "console-message",
            consoleLevel: "info",
            electronLevel: 1,
            line: 2,
            sourceId: "source.js",
            account: { label: "Logged out", username: "" },
          },
        }),
      ),
    ).toBe("game-window:1 - Logged out");
  });

  it("merges records by run id and record id while retaining only console records", () => {
    const current = [makeRecord(1), makeRecord(2)];
    const updated = makeRecord(2, { message: "updated" });
    const nonConsole = makeRecord(3, { data: { windowId: 1 } });

    expect(mergeConsoleRecords(current, [updated, nonConsole])).toEqual([
      current[0],
      updated,
    ]);
  });

  it("excludes locally hidden records from snapshot merges", () => {
    const first = makeRecord(1);
    const second = makeRecord(2);
    const hiddenKeys = new Set([consoleRecordKey(first)]);

    expect(
      mergeConsoleRecords(
        [],
        excludeConsoleRecordKeys([first, second], hiddenKeys),
      ),
    ).toEqual([second]);
  });

  it("exports visible records as NDJSON", () => {
    const record = makeRecord(1);

    expect(
      exportConsoleRecords(
        filterConsoleRecords([record], {
          levels: levels(["info"]),
          search: "",
          windowComponent: allWindowsFilter,
        }),
      ),
    ).toBe(JSON.stringify(record));
  });
});
