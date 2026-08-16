import { describe, expect, it } from "vitest";

import type { ScriptRunnerStatus } from "./ScriptRunner";
import { accountSessionScriptState } from "./accountScriptStatus";

const runningStatus: ScriptRunnerStatus = {
  name: "farm.js",
  startedAt: "2026-08-09T00:00:00.000Z",
  state: "running",
};

describe("account script status", () => {
  it("projects a running script without account identity", () => {
    expect(accountSessionScriptState(runningStatus)).toEqual({
      name: "farm.js",
      state: "running",
    });
  });

  it("uses an explicit fallback name while the runner is idle", () => {
    expect(accountSessionScriptState({ state: "idle" }, "farm.js")).toEqual({
      name: "farm.js",
      state: "idle",
    });
  });

  it("preserves runner failures as script failures", () => {
    expect(
      accountSessionScriptState({
        failedAt: "2026-08-09T00:00:00.000Z",
        message: "boom",
        name: "farm.js",
        state: "failed",
      }),
    ).toEqual({
      message: "boom",
      name: "farm.js",
      state: "failed",
    });
  });

  it("keeps an idle directly opened game idle", () => {
    expect(accountSessionScriptState({ state: "idle" })).toEqual({
      state: "idle",
    });
  });

  it("does not attribute a stopped runner to an old launch", () => {
    expect(
      accountSessionScriptState({
        reason: "Stopped by user",
        state: "stopped",
        stoppedAt: "2026-08-09T00:00:00.000Z",
      }),
    ).toEqual({ message: "Stopped by user", state: "stopped" });
  });
});
