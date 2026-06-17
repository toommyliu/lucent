import { describe, expect, it } from "@effect/vitest";
import type {
  ArmyLoopTauntCommandPayload,
  ArmyLoopTauntParticipantPayload,
} from "../../../shared/army";
import { LoopTauntCoordinator } from "./LoopTauntCoordinator";

interface ScheduledTask {
  cancelled: boolean;
  readonly callback: () => void;
  readonly delayMs: number;
}

const participants = [
  { name: "Alice", number: 1 },
  { name: "Bob", number: 2 },
] as const satisfies readonly ArmyLoopTauntParticipantPayload[];

const makeHarness = () => {
  const sent: Array<{
    readonly command: ArmyLoopTauntCommandPayload;
    readonly player: ArmyLoopTauntParticipantPayload;
  }> = [];
  const broadcasts: ArmyLoopTauntCommandPayload[] = [];
  const scheduled: ScheduledTask[] = [];
  const coordinator = new LoopTauntCoordinator({
    broadcastCommand: (command) => {
      broadcasts.push(command);
    },
    schedule: (delayMs, callback) => {
      const task: ScheduledTask = {
        callback,
        cancelled: false,
        delayMs,
      };
      scheduled.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    sendCommand: (player, command) => {
      sent.push({ command, player });
    },
    sessionId: "session-1",
  });

  coordinator.start({
    id: "loop-1",
    participants,
    playerName: "Alice",
    sessionId: "session-1",
    targetMonMapId: 7,
    trigger: { message: "strike", type: "message" },
  });

  const runNext = () => {
    while (scheduled.length > 0) {
      const task = scheduled.shift()!;
      if (!task.cancelled) {
        task.callback();
        return task;
      }
    }
    return undefined;
  };

  const triggerMessage = () => {
    coordinator.observe({
      id: "loop-1",
      message: "Boss prepares strike",
      playerName: "Alice",
      sessionId: "session-1",
      targetMonMapId: 7,
      triggerReason: "message-matched",
      type: "trigger",
    });
  };

  return {
    broadcasts,
    coordinator,
    runNext,
    sent,
    triggerMessage,
  };
};

const turnCommand = (
  command: ArmyLoopTauntCommandPayload,
): Extract<ArmyLoopTauntCommandPayload, { type: "turn" }> => {
  expect(command.type).toBe("turn");
  return command as Extract<ArmyLoopTauntCommandPayload, { type: "turn" }>;
};

describe("LoopTauntCoordinator", () => {
  it("deduplicates triggers while a turn is active", () => {
    const harness = makeHarness();

    harness.triggerMessage();
    harness.triggerMessage();
    harness.runNext();

    expect(harness.sent).toHaveLength(1);
    expect(turnCommand(harness.sent[0]!.command).selected).toEqual(
      participants[0],
    );
  });

  it("advances to the next participant when the selected player is ineligible", () => {
    const harness = makeHarness();
    harness.triggerMessage();
    harness.runNext();
    const first = turnCommand(harness.sent[0]!.command);

    harness.coordinator.observe({
      attempt: first.attempt,
      eligible: false,
      epoch: first.epoch,
      id: "loop-1",
      playerName: "Alice",
      reason: "should-taunt-false",
      sessionId: "session-1",
      targetMonMapId: 7,
      type: "turn-result",
    });

    expect(harness.sent).toHaveLength(2);
    expect(turnCommand(harness.sent[1]!.command).selected).toEqual(
      participants[1],
    );
  });

  it("stops the loop when the selected participant does not report", () => {
    const harness = makeHarness();
    harness.triggerMessage();
    harness.runNext();
    harness.runNext();

    expect(harness.broadcasts).toContainEqual({
      id: "loop-1",
      reason: "loop taunt selected participant did not report",
      sessionId: "session-1",
      type: "stop",
    });
  });

  it("retries once, then advances when Focus is not confirmed", () => {
    const harness = makeHarness();
    harness.triggerMessage();
    harness.runNext();
    const first = turnCommand(harness.sent[0]!.command);

    harness.coordinator.observe({
      attempt: first.attempt,
      eligible: true,
      epoch: first.epoch,
      id: "loop-1",
      outcome: "cast",
      playerName: "Alice",
      sessionId: "session-1",
      targetMonMapId: 7,
      type: "turn-result",
    });
    harness.runNext();
    harness.runNext();

    const retry = turnCommand(harness.sent[1]!.command);
    expect(retry.selected).toEqual(participants[0]);
    expect(retry.attempt).toBe(2);

    harness.coordinator.observe({
      attempt: retry.attempt,
      eligible: true,
      epoch: retry.epoch,
      id: "loop-1",
      outcome: "cast",
      playerName: "Alice",
      sessionId: "session-1",
      targetMonMapId: 7,
      type: "turn-result",
    });
    harness.runNext();

    expect(turnCommand(harness.sent[2]!.command).selected).toEqual(
      participants[1],
    );
  });

  it("Focus confirmation resets the turn and allows the next trigger", () => {
    const harness = makeHarness();
    harness.triggerMessage();
    harness.runNext();
    const first = turnCommand(harness.sent[0]!.command);

    harness.coordinator.observe({
      attempt: first.attempt,
      eligible: true,
      epoch: first.epoch,
      id: "loop-1",
      outcome: "cast",
      playerName: "Alice",
      sessionId: "session-1",
      targetMonMapId: 7,
      type: "turn-result",
    });
    harness.coordinator.observe({
      auraIcon: "iwd1,ied1",
      auraName: "Focus",
      id: "loop-1",
      playerName: "Bob",
      sessionId: "session-1",
      targetMonMapId: 7,
      type: "focus-active",
    });
    harness.triggerMessage();
    harness.runNext();

    expect(turnCommand(harness.sent[1]!.command).selected).toEqual(
      participants[1],
    );
  });

  it("broadcasts stop on target death", () => {
    const harness = makeHarness();

    harness.coordinator.observe({
      id: "loop-1",
      playerName: "Bob",
      sessionId: "session-1",
      targetMonMapId: 7,
      type: "target-dead",
    });

    expect(harness.broadcasts).toEqual([
      {
        id: "loop-1",
        reason: "target monster died",
        sessionId: "session-1",
        type: "stop",
      },
    ]);
  });
});
