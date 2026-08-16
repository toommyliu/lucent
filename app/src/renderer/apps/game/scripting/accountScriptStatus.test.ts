import { describe, expect, it } from "vitest";

import type { AccountGameLaunchPayload } from "@lucent/core/accounts";
import type { ScriptRunnerStatus } from "./ScriptRunner";
import { accountScriptRunnerState } from "./accountScriptStatus";

const runningStatus: ScriptRunnerStatus = {
  name: "farm.js",
  startedAt: "2026-08-09T00:00:00.000Z",
  state: "running",
};

describe("account script status", () => {
  it("publishes runner state for a directly opened game", () => {
    expect(accountScriptRunnerState(runningStatus, null)).toEqual({
      name: "farm.js",
      state: "running",
    });
  });

  it("uses an Account Manager launch as the script-name fallback", () => {
    const launchPayload: AccountGameLaunchPayload = {
      account: {
        label: "Alice",
        password: "secret",
        username: "Alice",
      },
      gameWindowId: 42,
      requestedAt: 0,
    };

    expect(accountScriptRunnerState(runningStatus, launchPayload)).toEqual({
      name: "farm.js",
      state: "running",
    });
  });

  it("preserves a direct script name when the runner stops", () => {
    const stoppedStatus: ScriptRunnerStatus = {
      reason: "User stopped the script",
      state: "stopped",
      stoppedAt: "2026-08-09T00:01:00.000Z",
    };

    expect(accountScriptRunnerState(stoppedStatus, null, "farm.js")).toEqual({
      name: "farm.js",
      reason: "User stopped the script",
      state: "stopped",
    });
  });
});
