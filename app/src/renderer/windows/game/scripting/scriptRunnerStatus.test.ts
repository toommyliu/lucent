import { describe, expect, it } from "@effect/vitest";
import {
  initialScriptRunnerStatusState,
  reduceScriptRunnerStatus,
} from "./scriptRunnerStatus";

describe("script runner status", () => {
  it("tracks the normal script lifecycle", () => {
    const initial = initialScriptRunnerStatusState(1);
    const starting = reduceScriptRunnerStatus(
      initial,
      { token: 1, status: "starting", scriptName: "farm.js" },
      2,
    );
    const running = reduceScriptRunnerStatus(
      starting,
      { token: 1, status: "running", scriptName: "farm.js" },
      3,
    );
    const stopped = reduceScriptRunnerStatus(
      running,
      { token: 1, status: "stopped", scriptName: "farm.js" },
      4,
    );

    expect([
      starting.status.status,
      running.status.status,
      stopped.status.status,
    ]).toEqual(["starting", "running", "stopped"]);
    expect(stopped.status.message).toBe("Stopped farm.js");
  });

  it("records script failures without converting them to stopped", () => {
    const starting = reduceScriptRunnerStatus(
      initialScriptRunnerStatusState(1),
      { token: 1, status: "starting", scriptName: "farm.js" },
      2,
    );
    const running = reduceScriptRunnerStatus(
      starting,
      { token: 1, status: "running", scriptName: "farm.js" },
      3,
    );
    const failed = reduceScriptRunnerStatus(
      running,
      {
        token: 1,
        status: "failed",
        scriptName: "farm.js",
        message: "boom",
      },
      4,
    );

    expect(failed.status).toMatchObject({
      status: "failed",
      scriptName: "farm.js",
      message: "boom",
    });
  });

  it("ignores stale completions from a replaced script", () => {
    const firstRunning = reduceScriptRunnerStatus(
      initialScriptRunnerStatusState(1),
      { token: 1, status: "running", scriptName: "first.js" },
      2,
    );
    const secondStarting = reduceScriptRunnerStatus(
      firstRunning,
      { token: 2, status: "starting", scriptName: "second.js" },
      3,
    );
    const staleFirstStopped = reduceScriptRunnerStatus(
      secondStarting,
      { token: 1, status: "stopped", scriptName: "first.js" },
      4,
    );

    expect(staleFirstStopped).toBe(secondStarting);
    expect(staleFirstStopped.status).toMatchObject({
      status: "starting",
      scriptName: "second.js",
    });
  });

  it("advances the token when restarting the same script", () => {
    const firstStarting = reduceScriptRunnerStatus(
      initialScriptRunnerStatusState(1),
      { token: 1, status: "starting", scriptName: "farm.js" },
      2,
    );
    const secondStarting = reduceScriptRunnerStatus(
      firstStarting,
      { token: 2, status: "starting", scriptName: "farm.js" },
      3,
    );
    const staleFirstStopped = reduceScriptRunnerStatus(
      secondStarting,
      { token: 1, status: "stopped", scriptName: "farm.js" },
      4,
    );
    const secondRunning = reduceScriptRunnerStatus(
      staleFirstStopped,
      { token: 2, status: "running", scriptName: "farm.js" },
      5,
    );

    expect(secondStarting.token).toBe(2);
    expect(staleFirstStopped.status.status).toBe("starting");
    expect(secondRunning.status.status).toBe("running");
  });
});
