import { describe, expect, it } from "vitest";
import * as Cause from "effect/Cause";

import {
  classifyScriptTermination,
  statusFromStartingCancellation,
} from "./ScriptRunner";
import { makeScriptExitSignal, ScriptStopSignal } from "./ScriptRunnerErrors";

describe("ScriptRunner", () => {
  it("returns a disconnected restart attempt to waiting after cancellation", () => {
    const status = statusFromStartingCancellation(
      {
        restart: {
          disconnectedAt: "2026-07-26T12:00:00.000Z",
          name: "Reconnect repro",
          path: "/scripts/reconnect-repro.js",
        },
      },
      {
        reason: "Connection lost",
        retryAfterReconnect: true,
      },
    );

    expect(status).toEqual({
      disconnectedAt: "2026-07-26T12:00:00.000Z",
      name: "Reconnect repro",
      path: "/scripts/reconnect-repro.js",
      state: "waiting-to-restart",
    });
  });

  it("stops an ordinary cancelled start", () => {
    expect(
      statusFromStartingCancellation({}, { reason: "Connection lost" }),
    ).toMatchObject({
      reason: "Connection lost",
      state: "stopped",
    });
  });

  it("classifies script failures", () => {
    expect(classifyScriptTermination(Cause.fail(new Error("boom")))).toEqual({
      kind: "failed",
    });
  });

  it("classifies script.stop() with its reason", () => {
    expect(
      classifyScriptTermination(
        Cause.fail(new ScriptStopSignal({ reason: "done" })),
      ),
    ).toEqual({ kind: "script-stopped", reason: "done" });
  });

  it("keeps plain script.exit() distinct from script.stop()", () => {
    expect(
      classifyScriptTermination(Cause.fail(makeScriptExitSignal())),
    ).toEqual({
      exitRequest: { closeWindow: false, logout: false },
      kind: "script-exited",
      reason: "Requested by the script",
    });
  });

  it("classifies action-bearing script.exit()", () => {
    expect(
      classifyScriptTermination(
        Cause.fail(makeScriptExitSignal({ closeWindow: true, logout: true })),
      ),
    ).toEqual({
      exitRequest: { closeWindow: true, logout: true },
      kind: "script-exited",
      reason: "Requested by the script",
    });
  });

  it("classifies external interruption", () => {
    expect(classifyScriptTermination(Cause.interrupt())).toEqual({
      kind: "script-interrupted",
    });
  });
});
