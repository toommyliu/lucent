import { describe, expect, it } from "@effect/vitest";

import type { ScriptRunnerStatus } from "./ScriptRunner";
import { accountSessionScriptState } from "./accountScriptStatus";

const runningStatus: ScriptRunnerStatus = {
  name: "farm.js",
  startedAt: "2026-08-09T00:00:00.000Z",
  state: "running",
};

describe("account script status", () => {
  it.each([
    {
      status: runningStatus,
      fallback: undefined,
      expected: { name: "farm.js", state: "running" },
    },
    {
      status: { state: "idle" },
      fallback: "farm.js",
      expected: { name: "farm.js", state: "idle" },
    },
    {
      status: {
        failedAt: "2026-08-09T00:00:00.000Z",
        message: "boom",
        name: "farm.js",
        state: "failed",
      },
      fallback: undefined,
      expected: { message: "boom", name: "farm.js", state: "failed" },
    },
    {
      status: { state: "idle" },
      fallback: undefined,
      expected: { state: "idle" },
    },
    {
      status: {
        reason: "Stopped by user",
        state: "stopped",
        stoppedAt: "2026-08-09T00:00:00.000Z",
      },
      fallback: undefined,
      expected: { message: "Stopped by user", state: "stopped" },
    },
  ] satisfies {
    status: ScriptRunnerStatus;
    fallback: string | undefined;
    expected: ReturnType<typeof accountSessionScriptState>;
  }[])(
    "projects $status.state with fallback $fallback",
    ({ status, fallback, expected }) => {
      expect(accountSessionScriptState(status, fallback)).toEqual(expected);
    },
  );
});
