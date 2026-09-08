import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";

import {
  classifyScriptTermination,
  planScriptOptionsUpdate,
  statusFromStartingCancellation,
} from "./ScriptRunner";
import { makeScriptExitSignal, ScriptStopSignal } from "./ScriptRunnerErrors";

describe("ScriptRunner", () => {
  it("includes an earlier unsaved option in the next persistence patch", () => {
    const persisted = {
      restartAfterReconnect: false,
      roomPolicy: { kind: "public" as const },
      safeStartStop: true,
    };
    const current = { ...persisted, safeStartStop: false };

    expect(
      planScriptOptionsUpdate(persisted, current, (options) => ({
        ...options,
        restartAfterReconnect: true,
      })).patch,
    ).toEqual({
      restartAfterReconnect: true,
      safeStartStop: false,
    });
  });

  it("plans a session reversal without a disk write after a failed save", () => {
    const persisted = {
      restartAfterReconnect: false,
      roomPolicy: { kind: "public" as const },
      safeStartStop: true,
    };
    const current = { ...persisted, safeStartStop: false };

    expect(
      planScriptOptionsUpdate(persisted, current, (options) => ({
        ...options,
        safeStartStop: true,
      })),
    ).toEqual({ next: persisted, patch: {} });
  });

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

  it.each([
    {
      name: "failure",
      cause: Cause.fail(new Error("boom")),
      expected: { kind: "failed" },
    },
    {
      name: "script stop",
      cause: Cause.fail(new ScriptStopSignal({ reason: "done" })),
      expected: { kind: "script-stopped", reason: "done" },
    },
    ...[false, true].map((actions) => ({
      name: actions ? "exit with actions" : "plain exit",
      cause: Cause.fail(
        makeScriptExitSignal({ closeClient: actions, logout: actions }),
      ),
      expected: {
        kind: "script-exited",
        exitRequest: { closeClient: actions, logout: actions },
        reason: "Requested by the script",
      },
    })),
    {
      name: "external interruption",
      cause: Cause.interrupt(),
      expected: { kind: "script-interrupted" },
    },
  ])("classifies $name", ({ cause, expected }) => {
    expect(classifyScriptTermination(cause)).toEqual(expected);
  });
});
