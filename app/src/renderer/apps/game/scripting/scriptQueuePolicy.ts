import type { ScriptRunTerminalOutcome } from "./ScriptRunner";

export type ScriptQueueTerminalDecision = "advance" | "finish" | "pause";

/** Decides the queue transition after one exact runner handle settles. */
export const scriptQueueTerminalDecision = (
  outcome: ScriptRunTerminalOutcome,
  hasNext: boolean,
): ScriptQueueTerminalDecision => {
  switch (outcome.kind) {
    case "completed":
    case "script-stopped":
      return hasNext ? "advance" : "finish";
    case "failed":
      return hasNext ? "pause" : "finish";
    case "externally-stopped":
    case "script-exited":
      return "finish";
  }
};
