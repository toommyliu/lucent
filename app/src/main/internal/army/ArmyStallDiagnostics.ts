// TEMPORARY(army-stall-diagnostics): records why army steps stall in builds
// without the debug flag. Remove once the stall has been diagnosed.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { ArmySessionState } from "./ArmyCoordinator";

export const ARMY_STALL_SCAN_INTERVAL_MS = 15_000;
export const ARMY_STALL_THRESHOLD_MS = 90_000;
export const ARMY_STALL_REPEAT_MS = 60_000;

export interface ArmyStallArrival {
  readonly complete?: boolean;
  readonly kind: "progress" | "sync";
  readonly label: string;
  readonly playerName: string;
  readonly sessionId: string;
  readonly step: number;
}

export interface ArmyStallScanEntry {
  readonly checkpoints: () => unknown;
  readonly session: ArmySessionState;
}

export interface ArmyStallLog {
  readonly message: string;
  readonly data: Record<string, unknown>;
}

interface StepRecord {
  readonly firstReportedAtMs: number;
  readonly kind: ArmyStallArrival["kind"];
  readonly label: string;
  lastWarnedAtMs: number | null;
}

interface PlayerReport {
  readonly atMs: number;
  readonly complete?: boolean;
  readonly kind: ArmyStallArrival["kind"];
  readonly label: string;
  readonly reports: number;
  readonly step: number;
}

interface SessionRecord {
  readonly players: Map<string, PlayerReport>;
  readonly steps: Map<number, StepRecord>;
}

export const makeArmyStallTracker = () => {
  const sessions = new Map<string, SessionRecord>();

  const recordArrival = (arrival: ArmyStallArrival) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((nowMs) => {
        let record = sessions.get(arrival.sessionId);
        if (record === undefined) {
          record = { players: new Map(), steps: new Map() };
          sessions.set(arrival.sessionId, record);
        }
        if (!record.steps.has(arrival.step)) {
          record.steps.set(arrival.step, {
            firstReportedAtMs: nowMs,
            kind: arrival.kind,
            label: arrival.label,
            lastWarnedAtMs: null,
          });
        }
        const previous = record.players.get(arrival.playerName);
        record.players.set(arrival.playerName, {
          atMs: nowMs,
          ...(arrival.complete === undefined
            ? {}
            : { complete: arrival.complete }),
          kind: arrival.kind,
          label: arrival.label,
          reports: previous?.step === arrival.step ? previous.reports + 1 : 1,
          step: arrival.step,
        });
      }),
    );

  /** Returns the log records to write; state is pruned as a side effect. */
  const scan = (entries: readonly ArmyStallScanEntry[]) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((nowMs) => {
        const logs: ArmyStallLog[] = [];
        const active = new Map(
          entries.map((entry) => [entry.session.sessionId, entry]),
        );
        for (const sessionId of sessions.keys()) {
          if (!active.has(sessionId)) sessions.delete(sessionId);
        }

        for (const [sessionId, record] of sessions) {
          const { checkpoints, session } = active.get(sessionId)!;
          const players = () =>
            session.players.map((playerName) => {
              const report = record.players.get(playerName);
              if (report === undefined) return { lastReport: null, playerName };
              const { atMs, ...rest } = report;
              return {
                lastReport: { ...rest, ageMs: nowMs - atMs },
                playerName,
              };
            });

          for (const [step, stepRecord] of record.steps) {
            const ageMs = nowMs - stepRecord.firstReportedAtMs;
            const base = {
              ageMs,
              configName: session.configName,
              kind: stepRecord.kind,
              label: stepRecord.label,
              room: session.room,
              sessionId,
              step,
            };
            if (session.completedSteps.has(step)) {
              record.steps.delete(step);
              if (stepRecord.lastWarnedAtMs !== null) {
                logs.push({ message: "Army step recovered", data: base });
              }
              continue;
            }
            if (
              ageMs < ARMY_STALL_THRESHOLD_MS ||
              (stepRecord.lastWarnedAtMs !== null &&
                nowMs - stepRecord.lastWarnedAtMs < ARMY_STALL_REPEAT_MS)
            ) {
              continue;
            }
            stepRecord.lastWarnedAtMs = nowMs;
            logs.push({
              message: "Army step stalled",
              data: {
                ...base,
                checkpoints: checkpoints(),
                completedSteps: [...session.completedSteps]
                  .sort((left, right) => left - right)
                  .slice(-3),
                players: players(),
              },
            });
          }
        }
        return logs;
      }),
    );

  return { recordArrival, scan };
};
