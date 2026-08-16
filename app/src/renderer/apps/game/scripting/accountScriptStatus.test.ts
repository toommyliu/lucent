import { describe, expect, it } from "vitest";

import type { AccountGameLaunchPayload } from "@lucent/core/accounts";
import type { ScriptRunnerStatus } from "./ScriptRunner";
import { accountScriptRunnerStatusUpdate } from "./accountScriptStatus";

const runningStatus: ScriptRunnerStatus = {
  name: "farm.js",
  startedAt: "2026-08-09T00:00:00.000Z",
  state: "running",
};

describe("account script status", () => {
  it("publishes runner status for a directly opened authenticated game", () => {
    expect(
      accountScriptRunnerStatusUpdate(runningStatus, "DirectPlayer", null),
    ).toEqual({
      currentUsername: "DirectPlayer",
      scriptName: "farm.js",
      status: "running",
    });
  });

  it("does not treat an Account Manager launch as authentication", () => {
    const launchPayload: AccountGameLaunchPayload = {
      account: {
        label: "Alice",
        password: "secret",
        username: "Alice",
      },
      gameWindowId: 42,
      requestedAt: 0,
    };

    expect(
      accountScriptRunnerStatusUpdate(runningStatus, undefined, launchPayload),
    ).toBeNull();
  });

  it("does not create a session before a direct game is authenticated", () => {
    expect(
      accountScriptRunnerStatusUpdate({ state: "idle" }, undefined, null),
    ).toBeNull();
  });
});
