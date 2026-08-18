import { describe, expect, it } from "vitest";

import type { ScriptRunTerminalOutcome } from "./ScriptRunner";
import { scriptQueueTerminalDecision } from "./scriptQueuePolicy";

const stoppedStatus = {
  state: "stopped",
  stoppedAt: "2026-08-17T12:00:00.000Z",
} as const;

const outcome = (
  kind: ScriptRunTerminalOutcome["kind"],
): ScriptRunTerminalOutcome => {
  switch (kind) {
    case "completed":
      return {
        kind,
        status: {
          completedAt: "2026-08-17T12:00:00.000Z",
          name: "First",
          state: "completed",
        },
      };
    case "failed":
      return {
        kind,
        status: {
          failedAt: "2026-08-17T12:00:00.000Z",
          message: "boom",
          name: "First",
          state: "failed",
        },
      };
    case "script-exited":
      return {
        exitRequest: { closeWindow: false, logout: false },
        kind,
        status: stoppedStatus,
      };
    case "externally-stopped":
    case "script-stopped":
      return { kind, status: stoppedStatus };
  }
};

describe("scriptQueueTerminalDecision", () => {
  it.each(["completed", "script-stopped"] as const)(
    "advances after %s when another item remains",
    (kind) => {
      expect(scriptQueueTerminalDecision(outcome(kind), true)).toBe("advance");
      expect(scriptQueueTerminalDecision(outcome(kind), false)).toBe("finish");
    },
  );

  it("pauses after a failure only when another item remains", () => {
    expect(scriptQueueTerminalDecision(outcome("failed"), true)).toBe("pause");
    expect(scriptQueueTerminalDecision(outcome("failed"), false)).toBe(
      "finish",
    );
  });

  it.each(["externally-stopped", "script-exited"] as const)(
    "finishes after %s",
    (kind) => {
      expect(scriptQueueTerminalDecision(outcome(kind), true)).toBe("finish");
    },
  );
});
