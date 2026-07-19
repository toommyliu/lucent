import {
  Clock,
  Context,
  Deferred,
  Effect,
  Layer,
  Result,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect";

import type {
  ArmyLoopTauntCommand,
  ArmyLoopTauntCommandPayload,
  ArmyLoopTauntLeavePayload,
  ArmyLoopTauntMapIdentity,
  ArmyLoopTauntRegisterPayload,
  ArmyLoopTauntRegisterResult,
  ArmyLoopTauntReport,
  ArmyLoopTauntReportPayload,
  ArmyLoopTauntResolvedTarget,
  ArmyLoopTauntRunPayload,
  ArmyLoopTauntStrategy,
  ArmyLoopTauntTerminalResult,
} from "@lucent/core/army";
import {
  ArmyCoordinator,
  type ArmyAuthenticatedParticipant,
  type ArmyCoordinatorError,
  type ArmyParticipantId,
} from "./ArmyCoordinator";

const COMMAND_CONFIRMATION_TIMEOUT_MS = 7_000;
const DEGRADED_AFTER_SWEEPS = 3;
const DEGRADED_TIMEOUT_MS = 30_000;
const MESSAGE_DEDUPE_MS = 500;
const REGISTRATION_TIMEOUT_MS = 30_000;
const SWEEP_RETRY_MS = 1_000;

const LoopTauntReasons = Schema.Literals([
  "inactive-run",
  "already-registered",
  "registration-failed",
  "registration-mismatch",
  "invalid-registration",
  "invalid-report",
  "sender-mismatch",
]);

export class ArmyLoopTauntError extends Schema.TaggedErrorClass<ArmyLoopTauntError>()(
  "ArmyLoopTauntError",
  {
    reason: LoopTauntReasons,
    detail: Schema.String,
    runId: Schema.optionalKey(Schema.String),
    sessionId: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export type ArmyLoopTauntOrchestratorError =
  | ArmyCoordinatorError
  | ArmyLoopTauntError;

export interface ArmyLoopTauntCommandEvent {
  readonly command: ArmyLoopTauntCommandPayload;
  readonly participantIds: readonly ArmyParticipantId[];
}

export interface ArmyLoopTauntOrchestratorShape {
  readonly await: (
    payload: ArmyLoopTauntRunPayload,
    senderId: ArmyParticipantId,
  ) => Effect.Effect<
    ArmyLoopTauntTerminalResult,
    ArmyLoopTauntOrchestratorError
  >;
  readonly leave: (
    payload: ArmyLoopTauntLeavePayload,
    senderId: ArmyParticipantId,
  ) => Effect.Effect<void, ArmyLoopTauntOrchestratorError>;
  readonly onCommand: (
    listener: (
      event: ArmyLoopTauntCommandEvent,
    ) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly register: (
    payload: ArmyLoopTauntRegisterPayload,
    senderId: ArmyParticipantId,
  ) => Effect.Effect<
    ArmyLoopTauntRegisterResult,
    ArmyLoopTauntOrchestratorError
  >;
  readonly ready: (
    payload: ArmyLoopTauntRunPayload,
    senderId: ArmyParticipantId,
  ) => Effect.Effect<void, ArmyLoopTauntOrchestratorError>;
  readonly report: (
    payload: ArmyLoopTauntReportPayload,
    senderId: ArmyParticipantId,
  ) => Effect.Effect<void, ArmyLoopTauntOrchestratorError>;
}

export class ArmyLoopTauntOrchestrator extends Context.Service<
  ArmyLoopTauntOrchestrator,
  ArmyLoopTauntOrchestratorShape
>()("lucent/internal/army/ArmyLoopTauntOrchestrator") {}

interface ParticipantReadiness {
  readonly alive: boolean;
  readonly readyAt: number;
  readonly usable: boolean;
}

interface RunParticipant extends ArmyAuthenticatedParticipant {
  readonly id: ArmyParticipantId;
  readonly readiness?: ParticipantReadiness | undefined;
  readonly targets: ReadonlyMap<number, ArmyLoopTauntResolvedTarget>;
}

interface PendingTaunt {
  readonly commandId: number;
  readonly participantId: ArmyParticipantId;
}

interface TurnState {
  readonly attempted: ReadonlySet<ArmyParticipantId>;
  readonly failedSweeps: number;
  readonly hadFailure: boolean;
  readonly id: number;
  readonly pending?: PendingTaunt | undefined;
}

interface DegradedState {
  readonly accumulatedMs: number;
  readonly activeSince?: number | undefined;
  readonly revision: number;
}

interface PendingMessage {
  readonly lifeRevision: number;
  readonly monsterMapId: number;
  readonly observedAt: number;
}

interface AssignmentState {
  readonly alive: boolean;
  readonly assignmentId: number;
  readonly cursorStart: number;
  readonly degraded?: DegradedState | undefined;
  readonly focusActive: boolean;
  readonly focusTurnConsumed: boolean;
  readonly lastMessageAt?: number | undefined;
  readonly lifeRevision: number;
  readonly monsterMapId: number;
  readonly nextTurnId: number;
  readonly pendingMessage?: PendingMessage | undefined;
  readonly players: readonly number[];
  readonly strategy: ArmyLoopTauntStrategy;
  readonly turn?: TurnState | undefined;
}

interface RunState {
  readonly assignments: ReadonlyMap<number, AssignmentState>;
  readonly map: ArmyLoopTauntMapIdentity;
  readonly nextCommandId: number;
  readonly participants: ReadonlyMap<ArmyParticipantId, RunParticipant>;
  readonly playerCount: number;
  readonly readinessGate: Deferred.Deferred<
    ArmyLoopTauntRegisterResult,
    ArmyLoopTauntError
  >;
  readonly runId: string;
  readonly sessionId: string;
  readonly status: "collecting" | "active" | "terminal";
  readonly terminal?: ArmyLoopTauntTerminalResult | undefined;
  readonly terminalGate: Deferred.Deferred<ArmyLoopTauntTerminalResult>;
}

interface OrchestratorState {
  readonly activeRunBySession: ReadonlyMap<string, string>;
  readonly nextRunId: number;
  readonly runs: ReadonlyMap<string, RunState>;
}

const initialState: OrchestratorState = {
  activeRunBySession: new Map(),
  nextRunId: 0,
  runs: new Map(),
};

type ScheduledTimer =
  | {
      readonly assignmentId: number;
      readonly commandId: number;
      readonly runId: string;
      readonly type: "command-timeout";
    }
  | {
      readonly runId: string;
      readonly type: "registration-timeout";
    }
  | {
      readonly assignmentId: number;
      readonly delayMs: number;
      readonly failedSweeps: number;
      readonly runId: string;
      readonly turnId: number;
      readonly type: "retry";
    }
  | {
      readonly assignmentId: number;
      readonly delayMs: number;
      readonly revision: number;
      readonly runId: string;
      readonly type: "degraded-timeout";
    };

type ReadinessEffect =
  | {
      readonly error: ArmyLoopTauntError;
      readonly gate: RunState["readinessGate"];
      readonly type: "fail";
    }
  | {
      readonly gate: RunState["readinessGate"];
      readonly result: ArmyLoopTauntRegisterResult;
      readonly type: "succeed";
    };

interface MutationEffects {
  readonly commands: readonly ArmyLoopTauntCommandEvent[];
  readonly readiness: readonly ReadinessEffect[];
  readonly terminals: readonly {
    readonly gate: Deferred.Deferred<ArmyLoopTauntTerminalResult>;
    readonly result: ArmyLoopTauntTerminalResult;
  }[];
  readonly timers: readonly ScheduledTimer[];
}

interface RunMutation extends MutationEffects {
  readonly run: RunState;
}

const noEffects = (): MutationEffects => ({
  commands: [],
  readiness: [],
  terminals: [],
  timers: [],
});

const mergeMutationEffects = (
  left: MutationEffects,
  right: MutationEffects,
): MutationEffects => ({
  commands: [...left.commands, ...right.commands],
  readiness: [...left.readiness, ...right.readiness],
  terminals: [...left.terminals, ...right.terminals],
  timers: [...left.timers, ...right.timers],
});

const loopError = (
  reason: typeof LoopTauntReasons.Type,
  detail: string,
  sessionId: string,
  runId?: string,
) =>
  new ArmyLoopTauntError({
    reason,
    detail,
    sessionId,
    ...(runId === undefined ? {} : { runId }),
  });

const uniqueNumbers = (values: readonly number[]): boolean =>
  new Set(values).size === values.length;

const sameNumbers = (
  left: readonly number[],
  right: readonly number[],
): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].toSorted((a, b) => a - b);
  const sortedRight = [...right].toSorted((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

const sameStrategy = (
  left: ArmyLoopTauntStrategy,
  right: ArmyLoopTauntStrategy,
): boolean =>
  left.type === right.type &&
  (left.type === "focus" ||
    (right.type === "message" && left.message === right.message));

const sameMap = (
  left: ArmyLoopTauntMapIdentity,
  right: ArmyLoopTauntMapIdentity,
): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.roomNumber === right.roomNumber;

const validateRegistration = (
  payload: ArmyLoopTauntRegisterPayload,
  playerCount: number,
): string | undefined => {
  if (payload.map.name.trim() === "") {
    return "Loop taunt map name must be non-empty";
  }
  if (payload.assignments.length === 0) {
    return "Loop taunt requires at least one assignment";
  }
  const assignmentIds = payload.assignments.map(
    (assignment) => assignment.assignmentId,
  );
  if (
    assignmentIds.some(
      (assignmentId) => !Number.isSafeInteger(assignmentId) || assignmentId < 0,
    )
  ) {
    return "Loop taunt assignment IDs must be non-negative integers";
  }
  if (!uniqueNumbers(assignmentIds)) {
    return "Loop taunt assignment IDs must be unique";
  }
  const assignedPlayers = new Set<number>();
  for (const assignment of payload.assignments) {
    if (assignment.players.length === 0 || !uniqueNumbers(assignment.players)) {
      return `Loop taunt assignment ${assignment.assignmentId} must contain unique players`;
    }
    for (const playerNumber of assignment.players) {
      if (
        !Number.isSafeInteger(playerNumber) ||
        playerNumber < 1 ||
        playerNumber > playerCount
      ) {
        return `Loop taunt assignment ${assignment.assignmentId} references player ${playerNumber} outside the Army roster`;
      }
      if (assignedPlayers.has(playerNumber)) {
        return `Loop taunt player ${playerNumber} appears in more than one assignment`;
      }
      assignedPlayers.add(playerNumber);
    }
    if (
      assignment.strategy.type === "message" &&
      assignment.strategy.message.trim() === ""
    ) {
      return `Loop taunt assignment ${assignment.assignmentId} requires a non-empty message`;
    }
  }
  return undefined;
};

const targetsByAssignment = (
  payload: ArmyLoopTauntRegisterPayload,
): ReadonlyMap<number, ArmyLoopTauntResolvedTarget> =>
  new Map(
    payload.assignments.map((assignment) => [
      assignment.assignmentId,
      assignment.target,
    ]),
  );

const registrationMatches = (
  run: RunState,
  payload: ArmyLoopTauntRegisterPayload,
): string | undefined => {
  if (!sameMap(run.map, payload.map)) {
    return "Loop taunt map identity must match across the Army roster";
  }
  if (run.assignments.size !== payload.assignments.length) {
    return "Loop taunt assignments must match across the Army roster";
  }
  const referenceParticipant = run.participants.values().next().value;
  for (const incoming of payload.assignments) {
    const assignment = run.assignments.get(incoming.assignmentId);
    if (
      assignment === undefined ||
      !sameNumbers(assignment.players, incoming.players) ||
      !sameStrategy(assignment.strategy, incoming.strategy)
    ) {
      return "Loop taunt assignments must match across the Army roster";
    }
    const referenceTarget = referenceParticipant?.targets.get(
      incoming.assignmentId,
    );
    if (
      referenceTarget !== undefined &&
      (referenceTarget.monsterMapId !== incoming.target.monsterMapId ||
        referenceTarget.lifeRevision !== incoming.target.lifeRevision)
    ) {
      return "Loop taunt resolved targets must use the same monster map IDs and life revisions across the Army roster";
    }
  }
  return undefined;
};

const setAssignment = (
  run: RunState,
  assignment: AssignmentState,
): RunState => ({
  ...run,
  assignments: new Map(run.assignments).set(
    assignment.assignmentId,
    assignment,
  ),
});

const setParticipant = (
  run: RunState,
  participant: RunParticipant,
): RunState => ({
  ...run,
  participants: new Map(run.participants).set(participant.id, participant),
});

const issueCommand = (
  run: RunState,
  participantIds: readonly ArmyParticipantId[],
  command: ArmyLoopTauntCommand,
): readonly [RunState, ArmyLoopTauntCommandEvent] => {
  const payload: ArmyLoopTauntCommandPayload = {
    command,
    commandId: run.nextCommandId,
    runId: run.runId,
    sessionId: run.sessionId,
  };
  return [
    { ...run, nextCommandId: run.nextCommandId + 1 },
    { command: payload, participantIds },
  ];
};

const assignmentRing = (
  run: RunState,
  assignment: AssignmentState,
): readonly RunParticipant[] => {
  const assigned = new Set(assignment.players);
  return [...run.participants.values()]
    .filter((participant) => assigned.has(participant.playerNumber))
    .toSorted((left, right) => left.playerNumber - right.playerNumber);
};

const orderedFromCursor = (
  run: RunState,
  assignment: AssignmentState,
  ring: readonly RunParticipant[],
): readonly RunParticipant[] =>
  ring.toSorted((left, right) => {
    const leftOffset =
      (left.playerNumber - 1 - assignment.cursorStart + run.playerCount) %
      run.playerCount;
    const rightOffset =
      (right.playerNumber - 1 - assignment.cursorStart + run.playerCount) %
      run.playerCount;
    return leftOffset - rightOffset;
  });

const isReady = (participant: RunParticipant, now: number): boolean =>
  participant.readiness?.alive === true &&
  participant.readiness.usable &&
  participant.readiness.readyAt <= now;

const startTurn = (assignment: AssignmentState): AssignmentState => {
  if (!assignment.alive || assignment.turn !== undefined) return assignment;
  return {
    ...assignment,
    nextTurnId: assignment.nextTurnId + 1,
    turn: {
      attempted: new Set(),
      failedSweeps: 0,
      hadFailure: false,
      id: assignment.nextTurnId,
    },
  };
};

const recoverAssignment = (assignment: AssignmentState): AssignmentState => ({
  ...assignment,
  degraded: undefined,
  turn:
    assignment.turn === undefined
      ? undefined
      : {
          ...assignment.turn,
          attempted:
            assignment.turn.pending === undefined
              ? new Set()
              : assignment.turn.attempted,
          failedSweeps: 0,
          hadFailure:
            assignment.turn.pending === undefined
              ? false
              : assignment.turn.hadFailure,
        },
});

const attemptAssignment = (
  inputRun: RunState,
  assignmentId: number,
  now: number,
): RunMutation => {
  const effects = noEffects();
  const assignment = inputRun.assignments.get(assignmentId);
  if (
    inputRun.status !== "active" ||
    assignment === undefined ||
    !assignment.alive ||
    assignment.turn === undefined ||
    assignment.turn.pending !== undefined
  ) {
    return { ...effects, run: inputRun };
  }

  const ring = orderedFromCursor(
    inputRun,
    assignment,
    assignmentRing(inputRun, assignment),
  );
  const hasInitialReadiness = ring.every(
    (participant) => participant.readiness !== undefined,
  );
  const participant = hasInitialReadiness
    ? ring.find(
        (candidate) =>
          !assignment.turn!.attempted.has(candidate.id) &&
          isReady(candidate, now),
      )
    : undefined;

  if (participant !== undefined) {
    const target = participant.targets.get(assignmentId);
    if (target === undefined) return { ...effects, run: inputRun };
    const [commandRun, command] = issueCommand(inputRun, [participant.id], {
      assignmentId,
      expiresAt: now + COMMAND_CONFIRMATION_TIMEOUT_MS,
      lifeRevision: assignment.lifeRevision,
      monsterMapId: target.monsterMapId,
      type: "taunt",
    });
    const updatedAssignment: AssignmentState = {
      ...assignment,
      turn: {
        ...assignment.turn,
        attempted: new Set(assignment.turn.attempted).add(participant.id),
        pending: {
          commandId: command.command.commandId,
          participantId: participant.id,
        },
      },
    };
    return {
      commands: [command],
      readiness: [],
      run: setAssignment(commandRun, updatedAssignment),
      terminals: [],
      timers: [
        {
          assignmentId,
          commandId: command.command.commandId,
          runId: inputRun.runId,
          type: "command-timeout",
        },
      ],
    };
  }

  const cooling = hasInitialReadiness
    ? ring.filter(
        (candidate) =>
          candidate.readiness?.alive === true &&
          candidate.readiness.usable &&
          candidate.readiness.readyAt > now,
      )
    : [];
  if (cooling.length > 0) {
    const readyAt = Math.min(
      ...cooling.map((candidate) => candidate.readiness!.readyAt),
    );
    const coolingIds = new Set(cooling.map((candidate) => candidate.id));
    const updatedAssignment: AssignmentState = {
      ...assignment,
      turn: {
        ...assignment.turn,
        attempted: new Set(
          [...assignment.turn.attempted].filter(
            (participantId) => !coolingIds.has(participantId),
          ),
        ),
      },
    };
    return {
      commands: [],
      readiness: [],
      run: setAssignment(inputRun, updatedAssignment),
      terminals: [],
      timers: [
        {
          assignmentId,
          delayMs: Math.max(1, readyAt - now),
          failedSweeps: assignment.turn.failedSweeps,
          runId: inputRun.runId,
          turnId: assignment.turn.id,
          type: "retry",
        },
      ],
    };
  }

  const failedSweeps = assignment.turn.failedSweeps + 1;
  const allSkipped =
    ring.length > 0 &&
    assignment.turn.attempted.size === ring.length &&
    !assignment.turn.hadFailure;
  if (allSkipped) {
    const updatedAssignment: AssignmentState = {
      ...assignment,
      degraded: undefined,
      turn: {
        ...assignment.turn,
        attempted: new Set(),
        failedSweeps: 0,
        hadFailure: false,
        pending: undefined,
      },
    };
    return {
      commands: [],
      readiness: [],
      run: setAssignment(inputRun, updatedAssignment),
      terminals: [],
      timers: [
        {
          assignmentId,
          delayMs: SWEEP_RETRY_MS,
          failedSweeps: 0,
          runId: inputRun.runId,
          turnId: assignment.turn.id,
          type: "retry",
        },
      ],
    };
  }

  const enteringDegraded =
    failedSweeps >= DEGRADED_AFTER_SWEEPS && assignment.degraded === undefined;
  const degraded: DegradedState | undefined = enteringDegraded
    ? {
        accumulatedMs: 0,
        activeSince: now,
        revision: 0,
      }
    : assignment.degraded;
  const updatedAssignment: AssignmentState = {
    ...assignment,
    degraded,
    turn: {
      ...assignment.turn,
      attempted: new Set(),
      failedSweeps,
      hadFailure: false,
      pending: undefined,
    },
  };
  let run = setAssignment(inputRun, updatedAssignment);
  const commands: ArmyLoopTauntCommandEvent[] = [];

  if (enteringDegraded) {
    const issued = issueCommand(run, [...run.participants.keys()], {
      assignmentId,
      code: "degraded",
      level: "warning",
      message: `Loop taunt is degraded for assignment ${assignmentId}`,
      type: "diagnostic",
    });
    run = issued[0];
    commands.push(issued[1]);
  }

  const probeIds =
    ring.length === 0
      ? [...run.participants.keys()]
      : ring.map((candidate) => candidate.id);
  if (probeIds.length > 0) {
    const issued = issueCommand(run, probeIds, { type: "probe" });
    run = issued[0];
    commands.push(issued[1]);
  }

  const timers: ScheduledTimer[] = [
    {
      assignmentId,
      delayMs: SWEEP_RETRY_MS,
      failedSweeps,
      runId: run.runId,
      turnId: updatedAssignment.turn!.id,
      type: "retry",
    },
  ];
  if (enteringDegraded) {
    timers.push({
      assignmentId,
      delayMs: DEGRADED_TIMEOUT_MS,
      revision: degraded!.revision,
      runId: run.runId,
      type: "degraded-timeout",
    });
  }
  return { commands, readiness: [], run, terminals: [], timers };
};

const refreshAssignmentFromTargets = (
  run: RunState,
  assignmentId: number,
): RunState => {
  const current = run.assignments.get(assignmentId);
  if (current === undefined) return run;
  const targets = [...run.participants.values()]
    .map((participant) => participant.targets.get(assignmentId))
    .filter(
      (target): target is ArmyLoopTauntResolvedTarget => target !== undefined,
    );
  if (targets.length === 0) {
    return setAssignment(run, {
      ...current,
      alive: false,
      focusActive: false,
      focusTurnConsumed: false,
      turn: undefined,
    });
  }
  const candidate = targets[0]!;
  const hasConsensus = targets.every(
    (target) =>
      target.monsterMapId === candidate.monsterMapId &&
      target.lifeRevision === candidate.lifeRevision,
  );
  const alive =
    hasConsensus && targets.every((target) => target.state === "alive");
  const focusActive = alive && targets.some((target) => target.focusActive);
  const canonicalChanged =
    hasConsensus &&
    (candidate.monsterMapId !== current.monsterMapId ||
      candidate.lifeRevision !== current.lifeRevision);
  const aliveChanged = alive !== current.alive;
  let assignment: AssignmentState = {
    ...current,
    alive,
    focusActive,
    focusTurnConsumed:
      aliveChanged || canonicalChanged ? false : current.focusTurnConsumed,
    lastMessageAt: canonicalChanged ? undefined : current.lastMessageAt,
    lifeRevision: hasConsensus ? candidate.lifeRevision : current.lifeRevision,
    monsterMapId: hasConsensus ? candidate.monsterMapId : current.monsterMapId,
    turn: !alive || canonicalChanged ? undefined : current.turn,
  };
  if (
    assignment.strategy.type === "message" &&
    assignment.pendingMessage !== undefined &&
    hasConsensus
  ) {
    const pendingMatches =
      alive &&
      assignment.pendingMessage.monsterMapId === candidate.monsterMapId &&
      assignment.pendingMessage.lifeRevision === candidate.lifeRevision;
    if (pendingMatches) {
      assignment = startTurn({
        ...assignment,
        lastMessageAt: assignment.pendingMessage.observedAt,
        pendingMessage: undefined,
      });
    } else {
      assignment = {
        ...assignment,
        pendingMessage: undefined,
      };
    }
  }
  if (assignment.strategy.type === "focus" && alive && focusActive) {
    assignment = {
      ...recoverAssignment(assignment),
      turn: undefined,
    };
  }
  return setAssignment(run, assignment);
};

const refreshAllAssignments = (inputRun: RunState): RunState => {
  let run = inputRun;
  for (const assignmentId of run.assignments.keys()) {
    run = refreshAssignmentFromTargets(run, assignmentId);
  }
  return run;
};

const reconcileTopology = (inputRun: RunState, now: number): RunMutation => {
  let run = inputRun;
  let effects: MutationEffects = noEffects();

  for (const assignmentId of run.assignments.keys()) {
    let assignment = run.assignments.get(assignmentId)!;
    const ring = assignmentRing(run, assignment);

    if (
      assignment.alive &&
      ring.length === 0 &&
      assignment.turn === undefined
    ) {
      assignment = startTurn(assignment);
    }
    if (
      assignment.alive &&
      assignment.strategy.type === "focus" &&
      !assignment.focusActive &&
      !assignment.focusTurnConsumed &&
      assignment.turn === undefined
    ) {
      assignment = {
        ...startTurn(assignment),
        focusTurnConsumed: true,
      };
    }

    const required = assignment.alive && assignment.turn !== undefined;
    if (!required) {
      let degraded = assignment.degraded;
      if (degraded?.activeSince !== undefined) {
        degraded = {
          accumulatedMs:
            degraded.accumulatedMs + Math.max(0, now - degraded.activeSince),
          revision: degraded.revision + 1,
        };
      }
      assignment = {
        ...assignment,
        degraded,
        turn: undefined,
      };
      run = setAssignment(run, assignment);
      continue;
    }

    if (
      assignment.degraded !== undefined &&
      assignment.degraded.activeSince === undefined
    ) {
      const degraded: DegradedState = {
        ...assignment.degraded,
        activeSince: now,
        revision: assignment.degraded.revision + 1,
      };
      assignment = { ...assignment, degraded };
      effects = mergeMutationEffects(effects, {
        commands: [],
        readiness: [],
        terminals: [],
        timers: [
          {
            assignmentId,
            delayMs: Math.max(0, DEGRADED_TIMEOUT_MS - degraded.accumulatedMs),
            revision: degraded.revision,
            runId: run.runId,
            type: "degraded-timeout",
          },
        ],
      });
    }

    const pendingParticipantId = assignment.turn?.pending?.participantId;
    if (
      pendingParticipantId !== undefined &&
      !ring.some((participant) => participant.id === pendingParticipantId)
    ) {
      const attempted = new Set(assignment.turn!.attempted);
      attempted.delete(pendingParticipantId);
      assignment = {
        ...assignment,
        turn: {
          ...assignment.turn!,
          attempted,
          hadFailure: true,
          pending: undefined,
        },
      };
    }

    run = setAssignment(run, assignment);
    const attempted = attemptAssignment(run, assignmentId, now);
    run = attempted.run;
    effects = mergeMutationEffects(effects, attempted);
  }

  return { ...effects, run };
};

const normalizeMessage = (message: string): string =>
  message.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();

const matchesMessage = (actual: string, configured: string): boolean => {
  const expected = normalizeMessage(configured);
  return expected !== "" && normalizeMessage(actual).includes(expected);
};

const terminalize = (
  run: RunState,
  result: ArmyLoopTauntTerminalResult,
): RunMutation => {
  if (run.status === "terminal") {
    return { ...noEffects(), run };
  }
  const assignments = new Map(
    [...run.assignments].map(([assignmentId, assignment]) => [
      assignmentId,
      { ...assignment, turn: undefined },
    ]),
  );
  const readiness: ReadinessEffect[] = [
    {
      error: loopError(
        "registration-failed",
        result.status === "failed"
          ? result.reason
          : "Loop taunt registration was superseded",
        run.sessionId,
        run.runId,
      ),
      gate: run.readinessGate,
      type: "fail",
    },
  ];
  return {
    commands: [],
    readiness,
    run: {
      ...run,
      assignments,
      status: "terminal",
      terminal: result,
    },
    terminals: [{ gate: run.terminalGate, result }],
    timers: [],
  };
};

const activateRun = (inputRun: RunState, now: number): RunMutation => {
  let run = refreshAllAssignments({ ...inputRun, status: "active" });
  let effects: MutationEffects = {
    ...noEffects(),
    readiness: [
      {
        gate: run.readinessGate,
        result: { runId: run.runId },
        type: "succeed",
      },
    ],
  };

  const participantIds = [...run.participants.keys()];
  if (participantIds.length > 0) {
    const issued = issueCommand(run, participantIds, { type: "probe" });
    run = issued[0];
    effects = mergeMutationEffects(effects, {
      commands: [issued[1]],
      readiness: [],
      terminals: [],
      timers: [],
    });
  }

  const reconciled = reconcileTopology(run, now);
  return {
    ...mergeMutationEffects(effects, reconciled),
    run: reconciled.run,
  };
};

const validateTargetReport = (
  run: RunState,
  participant: RunParticipant,
  report: Extract<
    ArmyLoopTauntReport,
    {
      readonly assignmentId: number;
      readonly lifeRevision: number;
      readonly monsterMapId: number;
    }
  >,
): ArmyLoopTauntError | undefined => {
  const target = participant.targets.get(report.assignmentId);
  if (
    target === undefined ||
    target.monsterMapId !== report.monsterMapId ||
    target.lifeRevision !== report.lifeRevision
  ) {
    return loopError(
      "invalid-report",
      `Loop taunt report does not match the sender target life for assignment ${report.assignmentId}`,
      run.sessionId,
      run.runId,
    );
  }
  return undefined;
};

const applyParticipantState = (
  inputRun: RunState,
  participantId: ArmyParticipantId,
  report: Extract<ArmyLoopTauntReport, { readonly type: "participant-state" }>,
  now: number,
): RunMutation => {
  const current = inputRun.participants.get(participantId)!;
  const cooldownMs = Number.isFinite(report.cooldownMs)
    ? Math.max(0, report.cooldownMs)
    : 0;
  const updatedParticipant: RunParticipant = {
    ...current,
    readiness: {
      alive: report.alive,
      readyAt: now + cooldownMs,
      usable: report.usable,
    },
  };
  let run = setParticipant(inputRun, updatedParticipant);
  let effects: MutationEffects = noEffects();
  const previousReadiness = current.readiness;
  const readinessImproved =
    previousReadiness !== undefined &&
    report.alive &&
    report.usable &&
    (!previousReadiness.alive ||
      !previousReadiness.usable ||
      updatedParticipant.readiness!.readyAt < previousReadiness.readyAt);
  const assignmentsToAttempt = new Set<number>();

  const assignments = new Map(run.assignments);
  for (const [assignmentId, assignment] of assignments) {
    if (
      !assignment.players.includes(current.playerNumber) ||
      assignment.turn === undefined
    ) {
      continue;
    }
    if (
      assignment.turn.pending?.participantId === participantId &&
      (!report.alive || !report.usable)
    ) {
      assignments.set(assignmentId, {
        ...assignment,
        turn: {
          ...assignment.turn,
          hadFailure: true,
          pending: undefined,
        },
      });
      assignmentsToAttempt.add(assignmentId);
      continue;
    }
    if (
      readinessImproved &&
      isReady(updatedParticipant, now) &&
      assignment.turn.pending === undefined
    ) {
      const attempted = new Set(assignment.turn.attempted);
      attempted.delete(participantId);
      assignments.set(assignmentId, {
        ...assignment,
        turn: {
          ...assignment.turn,
          attempted,
        },
      });
      assignmentsToAttempt.add(assignmentId);
    }
  }
  run = { ...run, assignments };
  if (previousReadiness === undefined) {
    for (const [assignmentId, assignment] of run.assignments) {
      if (
        assignment.turn !== undefined &&
        assignment.players.includes(current.playerNumber) &&
        assignmentRing(run, assignment).every(
          (participant) => participant.readiness !== undefined,
        )
      ) {
        assignmentsToAttempt.add(assignmentId);
      }
    }
  }

  for (const assignmentId of assignmentsToAttempt) {
    const attempted = attemptAssignment(run, assignmentId, now);
    run = attempted.run;
    effects = mergeMutationEffects(effects, attempted);
  }
  return { ...effects, run };
};

const applyTargetState = (
  inputRun: RunState,
  participant: RunParticipant,
  report: Extract<ArmyLoopTauntReport, { readonly type: "target-state" }>,
  now: number,
): RunMutation | ArmyLoopTauntError => {
  const existingTarget = participant.targets.get(report.assignmentId);
  if (existingTarget === undefined) {
    return loopError(
      "invalid-report",
      `Loop taunt target state does not match sender assignment ${report.assignmentId}`,
      inputRun.sessionId,
      inputRun.runId,
    );
  }
  if (report.lifeRevision < existingTarget.lifeRevision) {
    return { ...noEffects(), run: inputRun };
  }
  if (
    report.lifeRevision === existingTarget.lifeRevision &&
    report.monsterMapId !== existingTarget.monsterMapId
  ) {
    return loopError(
      "invalid-report",
      `Loop taunt target map changed without a new life revision for assignment ${report.assignmentId}`,
      inputRun.sessionId,
      inputRun.runId,
    );
  }
  const rebound = existingTarget.monsterMapId !== report.monsterMapId;
  const participantLifeChanged =
    existingTarget.lifeRevision !== report.lifeRevision;
  const resetFocus =
    participantLifeChanged ||
    rebound ||
    (existingTarget.state === "dead" && report.state === "alive");
  const focusActive =
    report.focusActive ?? (resetFocus ? false : existingTarget.focusActive);
  if (
    existingTarget.state === report.state &&
    existingTarget.monsterMapId === report.monsterMapId &&
    existingTarget.lifeRevision === report.lifeRevision &&
    existingTarget.focusActive === focusActive
  ) {
    return { ...noEffects(), run: inputRun };
  }

  let run = setParticipant(inputRun, {
    ...participant,
    targets: new Map(participant.targets).set(report.assignmentId, {
      focusActive,
      lifeRevision: report.lifeRevision,
      monsterMapId: report.monsterMapId,
      state: report.state,
    }),
  });
  run = refreshAssignmentFromTargets(run, report.assignmentId);
  const reconciled = reconcileTopology(run, now);
  return { ...reconciled, run: reconciled.run };
};

const applyFocusState = (
  inputRun: RunState,
  participant: RunParticipant,
  report: Extract<ArmyLoopTauntReport, { readonly type: "focus-state" }>,
  now: number,
): RunMutation | ArmyLoopTauntError => {
  const invalid = validateTargetReport(inputRun, participant, report);
  if (invalid !== undefined) return invalid;
  const current = inputRun.assignments.get(report.assignmentId)!;
  if (
    !current.alive ||
    current.monsterMapId !== report.monsterMapId ||
    current.lifeRevision !== report.lifeRevision
  ) {
    return { ...noEffects(), run: inputRun };
  }
  const target = participant.targets.get(report.assignmentId)!;
  if (target.focusActive === report.active) {
    return { ...noEffects(), run: inputRun };
  }
  let run = setParticipant(inputRun, {
    ...participant,
    targets: new Map(participant.targets).set(report.assignmentId, {
      ...target,
      focusActive: report.active,
    }),
  });
  run = refreshAssignmentFromTargets(run, report.assignmentId);
  let assignment = run.assignments.get(report.assignmentId)!;
  if (assignment.strategy.type !== "focus") {
    return { ...noEffects(), run };
  }
  if (assignment.focusActive) {
    assignment = {
      ...recoverAssignment(assignment),
      focusTurnConsumed: false,
      turn: undefined,
    };
  } else if (assignment.alive && !assignment.focusTurnConsumed) {
    assignment = {
      ...startTurn(assignment),
      focusTurnConsumed: true,
    };
  }
  run = setAssignment(run, assignment);
  return attemptAssignment(run, report.assignmentId, now);
};

const applyMessage = (
  inputRun: RunState,
  participant: RunParticipant,
  report: Extract<ArmyLoopTauntReport, { readonly type: "message" }>,
  now: number,
): RunMutation | ArmyLoopTauntError => {
  const invalid = validateTargetReport(inputRun, participant, report);
  if (invalid !== undefined) return invalid;
  const current = inputRun.assignments.get(report.assignmentId)!;
  if (
    current.strategy.type !== "message" ||
    !matchesMessage(report.message, current.strategy.message)
  ) {
    return { ...noEffects(), run: inputRun };
  }
  const senderTarget = participant.targets.get(report.assignmentId)!;
  if (
    !current.alive ||
    current.monsterMapId !== report.monsterMapId ||
    current.lifeRevision !== report.lifeRevision
  ) {
    if (senderTarget.state !== "alive") {
      return { ...noEffects(), run: inputRun };
    }
    const pending = current.pendingMessage;
    const shouldReplacePending =
      pending === undefined ||
      report.lifeRevision > pending.lifeRevision ||
      (report.lifeRevision === pending.lifeRevision &&
        report.monsterMapId !== pending.monsterMapId);
    return {
      ...noEffects(),
      run: setAssignment(inputRun, {
        ...current,
        pendingMessage: shouldReplacePending
          ? {
              lifeRevision: report.lifeRevision,
              monsterMapId: report.monsterMapId,
              observedAt: now,
            }
          : pending,
      }),
    };
  }
  if (
    current.lastMessageAt !== undefined &&
    now - current.lastMessageAt < MESSAGE_DEDUPE_MS
  ) {
    return { ...noEffects(), run: inputRun };
  }
  let assignment: AssignmentState = {
    ...current,
    lastMessageAt: now,
  };
  if (assignment.turn === undefined) assignment = startTurn(assignment);
  const run = setAssignment(inputRun, assignment);
  return reconcileTopology(run, now);
};

const applyCommandResult = (
  inputRun: RunState,
  participantId: ArmyParticipantId,
  report: Extract<ArmyLoopTauntReport, { readonly type: "command-result" }>,
  now: number,
): RunMutation => {
  const pendingEntry = [...inputRun.assignments].find(
    ([, assignment]) =>
      assignment.turn?.pending?.commandId === report.commandId &&
      assignment.turn.pending.participantId === participantId,
  );
  if (pendingEntry === undefined) {
    return { ...noEffects(), run: inputRun };
  }
  const [assignmentId, current] = pendingEntry;
  const participant = inputRun.participants.get(participantId)!;
  let run = inputRun;
  if (report.cooldownMs !== undefined) {
    const cooldownMs = Number.isFinite(report.cooldownMs)
      ? Math.max(0, report.cooldownMs)
      : 0;
    run = setParticipant(run, {
      ...participant,
      readiness: {
        alive: participant.readiness?.alive ?? true,
        readyAt: now + cooldownMs,
        usable: participant.readiness?.usable ?? true,
      },
    });
  }

  if (report.outcome === "confirmed") {
    if (current.strategy.type === "focus") {
      for (const currentParticipant of run.participants.values()) {
        const target = currentParticipant.targets.get(assignmentId);
        if (target === undefined) continue;
        run = setParticipant(run, {
          ...currentParticipant,
          targets: new Map(currentParticipant.targets).set(assignmentId, {
            ...target,
            focusActive: true,
          }),
        });
      }
    }
    const assignment: AssignmentState = {
      ...current,
      cursorStart: participant.playerNumber % inputRun.playerCount,
      degraded: undefined,
      focusActive:
        current.strategy.type === "focus" ? true : current.focusActive,
      focusTurnConsumed:
        current.strategy.type === "focus" ? false : current.focusTurnConsumed,
      turn: undefined,
    };
    run = setAssignment(run, assignment);
    return { ...noEffects(), run };
  }

  const assignment: AssignmentState = {
    ...current,
    turn: {
      ...current.turn!,
      hadFailure: report.outcome !== "skipped" || current.turn!.hadFailure,
      pending: undefined,
    },
  };
  run = setAssignment(run, assignment);
  return attemptAssignment(run, assignmentId, now);
};

const applyReport = (
  run: RunState,
  participantId: ArmyParticipantId,
  report: ArmyLoopTauntReport,
  now: number,
): RunMutation | ArmyLoopTauntError => {
  if (run.status === "terminal") return { ...noEffects(), run };
  const participant = run.participants.get(participantId)!;
  switch (report.type) {
    case "participant-state":
      return applyParticipantState(run, participantId, report, now);
    case "target-state":
      return applyTargetState(run, participant, report, now);
    case "focus-state":
      return applyFocusState(run, participant, report, now);
    case "message":
      return applyMessage(run, participant, report, now);
    case "command-result":
      return applyCommandResult(run, participantId, report, now);
    case "failed":
      return terminalize(run, {
        reason: report.reason,
        status: "failed",
      });
  }
};

const storeRun = (
  state: OrchestratorState,
  run: RunState,
): OrchestratorState => {
  const activeRunBySession = new Map(state.activeRunBySession);
  if (run.status === "terminal") {
    if (activeRunBySession.get(run.sessionId) === run.runId) {
      activeRunBySession.delete(run.sessionId);
    }
  } else {
    activeRunBySession.set(run.sessionId, run.runId);
  }
  return {
    ...state,
    activeRunBySession,
    runs: new Map(state.runs).set(run.runId, run),
  };
};

const runForPayload = (
  state: OrchestratorState,
  payload: ArmyLoopTauntRunPayload,
  senderId: ArmyParticipantId,
): RunState | ArmyLoopTauntError => {
  const run = state.runs.get(payload.runId);
  if (run === undefined || run.sessionId !== payload.sessionId) {
    return loopError(
      "inactive-run",
      "Loop taunt run is not active",
      payload.sessionId,
      payload.runId,
    );
  }
  if (!run.participants.has(senderId)) {
    return loopError(
      "sender-mismatch",
      "Loop taunt sender is not registered for this run",
      payload.sessionId,
      payload.runId,
    );
  }
  return run;
};

const onCommandTimeout = (
  state: OrchestratorState,
  timer: Extract<ScheduledTimer, { readonly type: "command-timeout" }>,
  now: number,
): readonly [MutationEffects, OrchestratorState] => {
  const run = state.runs.get(timer.runId);
  const assignment = run?.assignments.get(timer.assignmentId);
  if (
    run === undefined ||
    run.status !== "active" ||
    assignment?.turn?.pending?.commandId !== timer.commandId
  ) {
    return [noEffects(), state];
  }
  const updated = setAssignment(run, {
    ...assignment,
    turn: {
      ...assignment.turn,
      hadFailure: true,
      pending: undefined,
    },
  });
  const mutation = attemptAssignment(updated, timer.assignmentId, now);
  return [mutation, storeRun(state, mutation.run)];
};

const onRetry = (
  state: OrchestratorState,
  timer: Extract<ScheduledTimer, { readonly type: "retry" }>,
  now: number,
): readonly [MutationEffects, OrchestratorState] => {
  const run = state.runs.get(timer.runId);
  const turn = run?.assignments.get(timer.assignmentId)?.turn;
  if (
    run === undefined ||
    run.status !== "active" ||
    turn === undefined ||
    turn.id !== timer.turnId ||
    turn.failedSweeps !== timer.failedSweeps ||
    turn.pending !== undefined
  ) {
    return [noEffects(), state];
  }
  const mutation = attemptAssignment(run, timer.assignmentId, now);
  return [mutation, storeRun(state, mutation.run)];
};

const onDegradedTimeout = (
  state: OrchestratorState,
  timer: Extract<ScheduledTimer, { readonly type: "degraded-timeout" }>,
  now: number,
): readonly [MutationEffects, OrchestratorState] => {
  const run = state.runs.get(timer.runId);
  const assignment = run?.assignments.get(timer.assignmentId);
  const degraded = assignment?.degraded;
  if (
    run === undefined ||
    run.status !== "active" ||
    assignment === undefined ||
    !assignment.alive ||
    degraded?.activeSince === undefined ||
    degraded.revision !== timer.revision
  ) {
    return [noEffects(), state];
  }
  const elapsed =
    degraded.accumulatedMs + Math.max(0, now - degraded.activeSince);
  if (elapsed < DEGRADED_TIMEOUT_MS) {
    return [
      {
        commands: [],
        readiness: [],
        terminals: [],
        timers: [
          {
            assignmentId: timer.assignmentId,
            delayMs: DEGRADED_TIMEOUT_MS - elapsed,
            revision: timer.revision,
            runId: timer.runId,
            type: "degraded-timeout",
          },
        ],
      },
      state,
    ];
  }
  const mutation = terminalize(run, {
    reason: `Loop taunt remained degraded for assignment ${timer.assignmentId} for 30 seconds`,
    status: "failed",
  });
  return [mutation, storeRun(state, mutation.run)];
};

const onRegistrationTimeout = (
  state: OrchestratorState,
  timer: Extract<ScheduledTimer, { readonly type: "registration-timeout" }>,
): readonly [MutationEffects, OrchestratorState] => {
  const run = state.runs.get(timer.runId);
  if (run === undefined || run.status !== "collecting") {
    return [noEffects(), state];
  }
  const mutation = terminalize(run, {
    reason:
      "Loop taunt registration did not complete for the full Army roster within 30 seconds",
    status: "failed",
  });
  return [mutation, storeRun(state, mutation.run)];
};

type RegisterOutcome =
  | {
      readonly error: ArmyLoopTauntError;
      readonly type: "reject";
    }
  | {
      readonly effects: MutationEffects;
      readonly result: ArmyLoopTauntRegisterResult;
      readonly type: "accept";
    };

type OperationOutcome =
  | {
      readonly error: ArmyLoopTauntError;
      readonly type: "reject";
    }
  | {
      readonly effects: MutationEffects;
      readonly type: "accept";
    };

const makeCollectingRun = Effect.fn(
  "ArmyLoopTauntOrchestrator.makeCollectingRun",
)(function* (
  state: OrchestratorState,
  payload: ArmyLoopTauntRegisterPayload,
  playerCount: number,
): Effect.fn.Return<RunState> {
  const runId = `${payload.sessionId}:${state.nextRunId}`;
  const assignments = new Map<number, AssignmentState>(
    payload.assignments.map((assignment) => [
      assignment.assignmentId,
      {
        alive: assignment.target.state === "alive",
        assignmentId: assignment.assignmentId,
        cursorStart: 0,
        focusActive: assignment.target.focusActive,
        focusTurnConsumed: false,
        lifeRevision: assignment.target.lifeRevision,
        monsterMapId: assignment.target.monsterMapId,
        nextTurnId: 0,
        players: [...assignment.players],
        strategy:
          assignment.strategy.type === "focus"
            ? { type: "focus" }
            : {
                message: assignment.strategy.message,
                type: "message",
              },
      },
    ]),
  );
  return {
    assignments,
    map: { ...payload.map },
    nextCommandId: 0,
    participants: new Map(),
    playerCount,
    readinessGate: yield* Deferred.make<
      ArmyLoopTauntRegisterResult,
      ArmyLoopTauntError
    >(),
    runId,
    sessionId: payload.sessionId,
    status: "collecting",
    terminalGate: yield* Deferred.make<ArmyLoopTauntTerminalResult>(),
  };
});

export const makeArmyLoopTauntOrchestrator = (): Effect.Effect<
  ArmyLoopTauntOrchestratorShape,
  never,
  ArmyCoordinator | Scope.Scope
> =>
  Effect.gen(function* () {
    const coordinator = yield* ArmyCoordinator;
    const scope = yield* Effect.scope;
    const stateRef = yield* SynchronizedRef.make(initialState);
    const commandListeners = new Set<
      (event: ArmyLoopTauntCommandEvent) => Effect.Effect<void, unknown>
    >();

    const onCommand: ArmyLoopTauntOrchestratorShape["onCommand"] = (listener) =>
      Effect.sync(() => {
        commandListeners.add(listener);
        return () => {
          commandListeners.delete(listener);
        };
      });

    const currentCommand = (
      event: ArmyLoopTauntCommandEvent,
    ): Effect.Effect<ArmyLoopTauntCommandEvent | undefined> =>
      SynchronizedRef.get(stateRef).pipe(
        Effect.map((state) => {
          const run = state.runs.get(event.command.runId);
          if (run?.status !== "active") return undefined;
          const participantIds = event.participantIds.filter((participantId) =>
            run.participants.has(participantId),
          );
          if (participantIds.length === 0) return undefined;
          const command = event.command.command;
          if (command.type === "taunt") {
            const pending = run.assignments.get(command.assignmentId)?.turn
              ?.pending;
            if (
              pending?.commandId !== event.command.commandId ||
              pending.participantId !== participantIds[0] ||
              participantIds.length !== 1
            ) {
              return undefined;
            }
          } else if (
            command.type === "diagnostic" &&
            run.assignments.get(command.assignmentId)?.degraded === undefined
          ) {
            return undefined;
          }
          return { ...event, participantIds };
        }),
      );

    const publishCommands = (commands: readonly ArmyLoopTauntCommandEvent[]) =>
      Effect.forEach(
        commands,
        (command) =>
          currentCommand(command).pipe(
            Effect.flatMap((current) =>
              current === undefined
                ? Effect.void
                : Effect.forEach(
                    [...commandListeners],
                    (listener) =>
                      listener(current).pipe(
                        Effect.catchCause(() => Effect.void),
                      ),
                    { discard: true },
                  ),
            ),
          ),
        { discard: true },
      );

    const onTimer = (timer: ScheduledTimer) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const effects = yield* SynchronizedRef.modify(
          stateRef,
          (state): readonly [MutationEffects, OrchestratorState] => {
            switch (timer.type) {
              case "command-timeout":
                return onCommandTimeout(state, timer, now);
              case "registration-timeout":
                return onRegistrationTimeout(state, timer);
              case "retry":
                return onRetry(state, timer, now);
              case "degraded-timeout":
                return onDegradedTimeout(state, timer, now);
            }
          },
        );
        yield* applyEffects(effects);
      });

    const scheduleTimer = (timer: ScheduledTimer) => {
      const delayMs =
        timer.type === "command-timeout"
          ? COMMAND_CONFIRMATION_TIMEOUT_MS
          : timer.type === "registration-timeout"
            ? REGISTRATION_TIMEOUT_MS
            : timer.delayMs;
      return Effect.sleep(`${delayMs} millis`).pipe(
        Effect.andThen(onTimer(timer)),
        Effect.forkIn(scope),
        Effect.asVoid,
      );
    };

    const applyEffects = (effects: MutationEffects): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          effects.terminals,
          ({ gate, result }) =>
            Deferred.succeed(gate, result).pipe(Effect.asVoid),
          { concurrency: "unbounded", discard: true },
        );
        yield* Effect.forEach(
          effects.readiness,
          (readiness) => {
            if (readiness.type === "fail") {
              return Deferred.fail(readiness.gate, readiness.error).pipe(
                Effect.asVoid,
              );
            }
            return SynchronizedRef.get(stateRef).pipe(
              Effect.flatMap((state) => {
                const run = state.runs.get(readiness.result.runId);
                return run?.status === "active" &&
                  run.readinessGate === readiness.gate
                  ? Deferred.succeed(readiness.gate, readiness.result).pipe(
                      Effect.asVoid,
                    )
                  : Effect.void;
              }),
            );
          },
          { concurrency: "unbounded", discard: true },
        );
        yield* Effect.forEach(effects.timers, scheduleTimer, {
          discard: true,
        });
        yield* publishCommands(effects.commands);
      });

    const register: ArmyLoopTauntOrchestratorShape["register"] = (
      payload,
      senderId,
    ) =>
      Effect.gen(function* () {
        const identity = yield* coordinator.requireParticipant(
          payload.sessionId,
          senderId,
        );
        const invalid = validateRegistration(payload, identity.playerCount);
        if (invalid !== undefined) {
          return yield* loopError(
            "invalid-registration",
            invalid,
            payload.sessionId,
          );
        }
        const now = yield* Clock.currentTimeMillis;
        const outcome = yield* SynchronizedRef.modifyEffect<
          OrchestratorState,
          RegisterOutcome,
          never,
          never
        >(stateRef, (state) =>
          Effect.gen(function* () {
            const activeRunId = state.activeRunBySession.get(payload.sessionId);
            let run =
              activeRunId === undefined
                ? undefined
                : state.runs.get(activeRunId);
            let nextState = state;
            let effects: MutationEffects = noEffects();

            if (run?.status === "active") {
              const replaced = terminalize(run, { status: "completed" });
              nextState = storeRun(nextState, replaced.run);
              effects = mergeMutationEffects(effects, replaced);
              run = undefined;
            }

            if (run === undefined || run.status === "terminal") {
              run = yield* makeCollectingRun(
                nextState,
                payload,
                identity.playerCount,
              );
              nextState = {
                ...nextState,
                activeRunBySession: new Map(nextState.activeRunBySession).set(
                  payload.sessionId,
                  run.runId,
                ),
                nextRunId: nextState.nextRunId + 1,
                runs: new Map(nextState.runs).set(run.runId, run),
              };
              effects = mergeMutationEffects(effects, {
                commands: [],
                readiness: [],
                terminals: [],
                timers: [
                  {
                    runId: run.runId,
                    type: "registration-timeout",
                  },
                ],
              });
            } else {
              const mismatch = registrationMatches(run, payload);
              if (mismatch !== undefined) {
                return [
                  {
                    error: loopError(
                      "registration-mismatch",
                      mismatch,
                      payload.sessionId,
                      run.runId,
                    ),
                    type: "reject" as const,
                  },
                  state,
                ] as const;
              }
            }

            if (run.playerCount !== identity.playerCount) {
              return [
                {
                  error: loopError(
                    "registration-mismatch",
                    "Loop taunt roster size changed during registration",
                    payload.sessionId,
                    run.runId,
                  ),
                  type: "reject" as const,
                },
                state,
              ] as const;
            }
            if (run.participants.has(senderId)) {
              return [
                {
                  error: loopError(
                    "already-registered",
                    "Loop taunt sender is already registered",
                    payload.sessionId,
                    run.runId,
                  ),
                  type: "reject" as const,
                },
                state,
              ] as const;
            }

            run = setParticipant(run, {
              ...identity,
              id: senderId,
              targets: targetsByAssignment(payload),
            });
            if (run.participants.size === run.playerCount) {
              const activated = activateRun(run, now);
              run = activated.run;
              effects = mergeMutationEffects(effects, activated);
            }
            nextState = storeRun(nextState, run);
            return [
              {
                effects,
                result: { runId: run.runId },
                type: "accept" as const,
              },
              nextState,
            ] as const;
          }),
        );
        if (outcome.type === "reject") return yield* outcome.error;
        const reauthenticated = yield* coordinator
          .requireParticipant(payload.sessionId, senderId)
          .pipe(Effect.result);
        if (Result.isFailure(reauthenticated)) {
          const cleanup = yield* SynchronizedRef.modify(
            stateRef,
            (state): readonly [MutationEffects, OrchestratorState] => {
              const run = state.runs.get(outcome.result.runId);
              if (
                run === undefined ||
                run.status === "terminal" ||
                !run.participants.has(senderId)
              ) {
                return [noEffects(), state];
              }
              const mutation = terminalize(run, {
                reason: "Army session ended during Loop Taunt registration",
                status: "failed",
              });
              return [mutation, storeRun(state, mutation.run)];
            },
          );
          yield* applyEffects(mergeMutationEffects(outcome.effects, cleanup));
          return yield* reauthenticated.failure;
        }
        yield* applyEffects(outcome.effects);
        return outcome.result;
      });

    const ready: ArmyLoopTauntOrchestratorShape["ready"] = (
      payload,
      senderId,
    ) =>
      Effect.gen(function* () {
        yield* coordinator.requireParticipant(payload.sessionId, senderId);
        const run = yield* SynchronizedRef.get(stateRef).pipe(
          Effect.map((state) => runForPayload(state, payload, senderId)),
        );
        if (run instanceof ArmyLoopTauntError) return yield* run;
        if (run.status === "terminal") {
          return yield* loopError(
            "registration-failed",
            run.terminal?.status === "failed"
              ? run.terminal.reason
              : "Loop taunt registration was superseded",
            run.sessionId,
            run.runId,
          );
        }
        yield* Deferred.await(run.readinessGate);
      });

    const awaitRun: ArmyLoopTauntOrchestratorShape["await"] = (
      payload,
      senderId,
    ) =>
      Effect.gen(function* () {
        yield* coordinator.requireParticipant(payload.sessionId, senderId);
        const run = yield* SynchronizedRef.get(stateRef).pipe(
          Effect.map((state) => runForPayload(state, payload, senderId)),
        );
        if (run instanceof ArmyLoopTauntError) return yield* run;
        return yield* Deferred.await(run.terminalGate);
      });

    const report: ArmyLoopTauntOrchestratorShape["report"] = (
      payload,
      senderId,
    ) =>
      Effect.gen(function* () {
        yield* coordinator.requireParticipant(payload.sessionId, senderId);
        const now = yield* Clock.currentTimeMillis;
        const outcome = yield* SynchronizedRef.modify(
          stateRef,
          (state): readonly [OperationOutcome, OrchestratorState] => {
            const run = runForPayload(state, payload, senderId);
            if (run instanceof ArmyLoopTauntError) {
              return [{ error: run, type: "reject" }, state];
            }
            const mutation = applyReport(run, senderId, payload.report, now);
            if (mutation instanceof ArmyLoopTauntError) {
              return [{ error: mutation, type: "reject" }, state];
            }
            return [
              { effects: mutation, type: "accept" },
              storeRun(state, mutation.run),
            ];
          },
        );
        if (outcome.type === "reject") return yield* outcome.error;
        yield* applyEffects(outcome.effects);
      });

    const leave: ArmyLoopTauntOrchestratorShape["leave"] = (
      payload,
      senderId,
    ) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const effects = yield* SynchronizedRef.modify(
          stateRef,
          (state): readonly [MutationEffects, OrchestratorState] => {
            const run = state.runs.get(payload.runId);
            if (
              run === undefined ||
              run.sessionId !== payload.sessionId ||
              run.status === "terminal" ||
              !run.participants.has(senderId)
            ) {
              return [noEffects(), state];
            }
            const participants = new Map(run.participants);
            const participant = participants.get(senderId)!;
            participants.delete(senderId);
            let updated: RunState = { ...run, participants };

            if (run.status === "collecting") {
              const reason =
                payload.reason?.trim() ||
                `Loop taunt participant left during registration: ${participant.playerName}`;
              const mutation = terminalize(updated, {
                reason,
                status: "failed",
              });
              return [mutation, storeRun(state, mutation.run)];
            }
            if (participants.size === 0) {
              const mutation = terminalize(updated, {
                status: "completed",
              });
              return [mutation, storeRun(state, mutation.run)];
            }

            updated = refreshAllAssignments(updated);
            const reconciled = reconcileTopology(updated, now);
            return [reconciled, storeRun(state, reconciled.run)];
          },
        );
        yield* applyEffects(effects);
      });

    const endSession = (
      sessionId: string,
      reason: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const effects = yield* SynchronizedRef.modify(
          stateRef,
          (state): readonly [MutationEffects, OrchestratorState] => {
            const runs = new Map(state.runs);
            const activeRunBySession = new Map(state.activeRunBySession);
            let effects: MutationEffects = noEffects();
            for (const [runId, run] of state.runs) {
              if (run.sessionId !== sessionId) continue;
              runs.delete(runId);
              if (run.status !== "terminal") {
                const mutation = terminalize(run, {
                  reason,
                  status: "failed",
                });
                effects = mergeMutationEffects(effects, mutation);
              }
            }
            activeRunBySession.delete(sessionId);
            return [effects, { ...state, activeRunBySession, runs }];
          },
        );
        yield* applyEffects(effects);
      });

    const unsubscribe = yield* coordinator.onSessionEnded((event) =>
      endSession(event.sessionId, event.reason),
    );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        unsubscribe();
        const state = yield* SynchronizedRef.get(stateRef);
        const sessions = new Set(
          [...state.runs.values()].map((run) => run.sessionId),
        );
        for (const sessionId of sessions) {
          yield* endSession(sessionId, "Application is quitting");
        }
        commandListeners.clear();
      }),
    );

    return ArmyLoopTauntOrchestrator.of({
      await: awaitRun,
      leave,
      onCommand,
      ready,
      register,
      report,
    });
  });

export const layer = Layer.effect(
  ArmyLoopTauntOrchestrator,
  makeArmyLoopTauntOrchestrator(),
);
