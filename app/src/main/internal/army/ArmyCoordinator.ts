import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";

import {
  normalizeArmyPlayerKey,
  type ArmyConfigPayload,
  type ArmyProgressResult,
  type ArmySessionPayload,
} from "@lucent/core/army";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../../app/observability/DesktopObservability";

export const ARMY_START_TIMEOUT_MS = 120_000;
export const ARMY_SYNC_TIMEOUT_MS = 10 * 60_000;

const SessionReasons = Schema.Literals([
  "inactive",
  "not-started",
  "aborted",
  "start-timeout",
]);

export class ArmySessionError extends Schema.TaggedErrorClass<ArmySessionError>()(
  "ArmySessionError",
  {
    reason: SessionReasons,
    detail: Schema.String,
    sessionId: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const ParticipantReasons = Schema.Literals([
  "not-configured",
  "already-joined",
  "not-joined",
  "sender-mismatch",
]);

export class ArmyParticipantError extends Schema.TaggedErrorClass<ArmyParticipantError>()(
  "ArmyParticipantError",
  {
    reason: ParticipantReasons,
    detail: Schema.String,
    playerName: Schema.optionalKey(Schema.String),
    sessionId: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const SynchronizationReasons = Schema.Literals([
  "timeout",
  "duplicate-arrival",
  "signature-mismatch",
  "completed-step",
  "invalid-step",
]);

export class ArmySynchronizationError extends Schema.TaggedErrorClass<ArmySynchronizationError>()(
  "ArmySynchronizationError",
  {
    reason: SynchronizationReasons,
    detail: Schema.String,
    label: Schema.optionalKey(Schema.String),
    sessionId: Schema.String,
    step: Schema.Int,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export type ArmyCoordinatorError =
  | ArmySessionError
  | ArmyParticipantError
  | ArmySynchronizationError;

export type ArmyParticipantId = number;

export type ArmySessionEndKind =
  | "application-quit"
  | "checkpoint-timeout"
  | "interrupted"
  | "participant-failed"
  | "participant-left"
  | "participant-unavailable"
  | "requested"
  | "start-timeout"
  | "synchronization-error";

export interface ArmySessionEndCause {
  readonly kind: ArmySessionEndKind;
  readonly reason: string;
}

export interface ArmySessionEndedEvent {
  readonly participantIds: readonly ArmyParticipantId[];
  readonly reason: string;
  readonly sessionId: string;
}

export interface ArmyAuthenticatedParticipant {
  readonly playerCount: number;
  readonly playerName: string;
  readonly playerNumber: number;
  readonly sessionId: string;
}

interface Participant {
  readonly playerName: string;
  readonly id: ArmyParticipantId;
}

interface StepSignature {
  readonly kind: "barrier" | "progress";
  readonly label: string;
  readonly timeoutMs: number;
}

interface BarrierCheckpoint {
  readonly arrived: ReadonlySet<string>;
  readonly gate: Deferred.Deferred<void, ArmyCoordinatorError>;
  readonly kind: "barrier";
  readonly signature: StepSignature;
}

interface ProgressCheckpoint {
  readonly arrived: ReadonlyMap<string, boolean>;
  readonly gate: Deferred.Deferred<ArmyProgressResult, ArmyCoordinatorError>;
  readonly kind: "progress";
  readonly signature: StepSignature;
}

type Checkpoint = BarrierCheckpoint | ProgressCheckpoint;

export interface ArmySessionState extends ArmyConfigPayload {
  readonly checkpoints: ReadonlyMap<number, Checkpoint>;
  readonly completedSteps: ReadonlySet<number>;
  readonly createdAtMs: number;
  readonly participants: ReadonlyMap<string, Participant>;
  readonly playerKeys: ReadonlySet<string>;
  readonly sessionId: string;
  readonly signatures: ReadonlyMap<number, StepSignature>;
  readonly startedAtMs: number | null;
  readonly startGate: Deferred.Deferred<void, ArmyCoordinatorError>;
  readonly status: "collecting" | "active";
}

interface CoordinatorState {
  readonly activeSessionByConfig: ReadonlyMap<string, string>;
  readonly nextSessionId: number;
  readonly sessions: ReadonlyMap<string, ArmySessionState>;
  readonly participantSessions: ReadonlyMap<ArmyParticipantId, string>;
}

const initialState: CoordinatorState = {
  activeSessionByConfig: new Map(),
  nextSessionId: 0,
  sessions: new Map(),
  participantSessions: new Map(),
};

export interface ArmyCoordinatorShape {
  readonly abortParticipant: (
    participantId: ArmyParticipantId,
    cause: ArmySessionEndCause,
  ) => Effect.Effect<void>;
  readonly abortSession: (
    sessionId: string,
    cause: ArmySessionEndCause,
  ) => Effect.Effect<void>;
  readonly fail: (
    sessionId: string,
    participantId: ArmyParticipantId,
    reason: string,
  ) => Effect.Effect<void, ArmyCoordinatorError>;
  readonly getSessions: () => Effect.Effect<readonly ArmySessionState[]>;
  readonly join: (
    config: ArmyConfigPayload,
    playerName: string,
    participantId: ArmyParticipantId,
  ) => Effect.Effect<ArmySessionPayload, ArmyCoordinatorError>;
  readonly leave: (
    sessionId: string,
    participantId: ArmyParticipantId,
  ) => Effect.Effect<void, ArmyCoordinatorError>;
  readonly onSessionEnded: (
    listener: (event: ArmySessionEndedEvent) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<() => void>;
  readonly progress: (
    sessionId: string,
    participantId: ArmyParticipantId,
    payload: {
      readonly complete: boolean;
      readonly label?: string;
      readonly step: number;
      readonly timeoutMs?: number;
    },
  ) => Effect.Effect<ArmyProgressResult, ArmyCoordinatorError>;
  readonly requireParticipant: (
    sessionId: string,
    participantId: ArmyParticipantId,
  ) => Effect.Effect<ArmyAuthenticatedParticipant, ArmyCoordinatorError>;
  readonly sync: (
    sessionId: string,
    participantId: ArmyParticipantId,
    payload: {
      readonly label?: string;
      readonly step: number;
      readonly timeoutMs?: number;
    },
  ) => Effect.Effect<void, ArmyCoordinatorError>;
}

export class ArmyCoordinator extends Context.Service<
  ArmyCoordinator,
  ArmyCoordinatorShape
>()("lucent/internal/army/ArmyCoordinator") {}

type JoinOutcome =
  | { readonly error: ArmyCoordinatorError; readonly type: "reject" }
  | {
      readonly activated: boolean;
      readonly playerKey: string;
      readonly session: ArmySessionState;
      readonly type: "wait";
    };

type BarrierOutcome =
  | { readonly error: ArmyCoordinatorError; readonly type: "reject" }
  | {
      readonly complete: boolean;
      readonly gate: Deferred.Deferred<void, ArmyCoordinatorError>;
      readonly type: "wait";
    };

type ProgressOutcome =
  | { readonly error: ArmyCoordinatorError; readonly type: "reject" }
  | {
      readonly gate: Deferred.Deferred<
        ArmyProgressResult,
        ArmyCoordinatorError
      >;
      readonly result?: ArmyProgressResult;
      readonly type: "wait";
    };

const normalizeTimeout = (value: number | undefined): number =>
  Number.isFinite(value)
    ? Math.max(1, Math.trunc(value!))
    : ARMY_SYNC_TIMEOUT_MS;

const normalizeLabel = (label: string | undefined): string =>
  label === undefined ? "sync" : label;

const sessionError = (
  reason: typeof SessionReasons.Type,
  detail: string,
  sessionId?: string,
) =>
  new ArmySessionError({
    reason,
    detail,
    ...(sessionId === undefined ? {} : { sessionId }),
  });

const participantError = (
  reason: typeof ParticipantReasons.Type,
  detail: string,
  sessionId?: string,
  playerName?: string,
) =>
  new ArmyParticipantError({
    reason,
    detail,
    ...(playerName === undefined ? {} : { playerName }),
    ...(sessionId === undefined ? {} : { sessionId }),
  });

const syncError = (
  reason: typeof SynchronizationReasons.Type,
  detail: string,
  sessionId: string,
  step: number,
  label?: string,
) =>
  new ArmySynchronizationError({
    reason,
    detail,
    sessionId,
    step,
    ...(label === undefined ? {} : { label }),
  });

const canonicalPlayerName = (
  session: Pick<ArmySessionState, "players">,
  playerKey: string,
): string =>
  session.players.find(
    (player) => normalizeArmyPlayerKey(player) === playerKey,
  ) ?? playerKey;

const playerNumber = (
  session: Pick<ArmySessionState, "players">,
  playerKey: string,
): number =>
  session.players.findIndex(
    (player) => normalizeArmyPlayerKey(player) === playerKey,
  ) + 1;

const toPayload = (
  session: ArmySessionState,
  playerKey: string,
): ArmySessionPayload => {
  const number = playerNumber(session, playerKey);
  return {
    configName: session.configName,
    items: session.items,
    playerName: canonicalPlayerName(session, playerKey),
    playerNumber: number,
    players: session.players,
    raw: session.raw,
    role: number === 1 ? "leader" : "member",
    room: session.room,
    sessionId: session.sessionId,
    sets: session.sets,
  };
};

const findParticipant = (
  session: ArmySessionState,
  participantId: ArmyParticipantId,
): readonly [string, Participant] | undefined =>
  [...session.participants].find(
    ([, participant]) => participant.id === participantId,
  );

const missingPlayers = (
  session: ArmySessionState,
  arrived: ReadonlySet<string>,
): readonly string[] =>
  session.players.filter(
    (player) => !arrived.has(normalizeArmyPlayerKey(player)),
  );

const sameSignature = (left: StepSignature, right: StepSignature): boolean =>
  left.kind === right.kind &&
  left.label === right.label &&
  left.timeoutMs === right.timeoutMs;

const signatureDescription = (signature: StepSignature): string =>
  `${signature.kind} ${signature.label}`;

type ArmyObservability = Pick<DesktopObservabilityShape, "info" | "warn">;

const noOpObservability: ArmyObservability = {
  info: () => Effect.void,
  warn: () => Effect.void,
};

const rosterSnapshot = (session: ArmySessionState) =>
  session.players.map((playerName) => ({
    playerName,
    rendererId:
      session.participants.get(normalizeArmyPlayerKey(playerName))?.id ?? null,
  }));

const checkpointSnapshot = (session: ArmySessionState) =>
  [...session.checkpoints.entries()]
    .sort(([left], [right]) => left - right)
    .map(([step, checkpoint]) => {
      const arrivedKeys =
        checkpoint.kind === "barrier"
          ? checkpoint.arrived
          : new Set(checkpoint.arrived.keys());
      return {
        arrivedPlayers: session.players.filter((playerName) =>
          arrivedKeys.has(normalizeArmyPlayerKey(playerName)),
        ),
        kind: checkpoint.kind === "barrier" ? "sync" : "progress",
        label: checkpoint.signature.label,
        missingPlayers: missingPlayers(session, arrivedKeys),
        step,
        timeoutMs: checkpoint.signature.timeoutMs,
      };
    });

const lastCompletedStep = (session: ArmySessionState): number | null =>
  session.completedSteps.size === 0
    ? null
    : Math.max(...session.completedSteps);

const isNormalSessionEnd = (cause: ArmySessionEndCause): boolean =>
  cause.kind === "application-quit" || cause.kind === "participant-left";

// A slow filesystem must not delay roster gates or session-end notifications.
const writeLifecycleLog = (log: Effect.Effect<void>): Effect.Effect<void> =>
  log.pipe(Effect.forkDetach, Effect.asVoid);

export const makeArmyCoordinator = (
  observability: ArmyObservability = noOpObservability,
): Effect.Effect<ArmyCoordinatorShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    const stateRef = yield* SynchronizedRef.make(initialState);
    const sessionEndedListeners = new Set<
      (event: ArmySessionEndedEvent) => Effect.Effect<void, unknown>
    >();

    const onSessionEnded: ArmyCoordinatorShape["onSessionEnded"] = (listener) =>
      Effect.sync(() => {
        sessionEndedListeners.add(listener);
        return () => {
          sessionEndedListeners.delete(listener);
        };
      });

    const publishSessionEnded = (event: ArmySessionEndedEvent) =>
      Effect.forEach(
        [...sessionEndedListeners],
        (listener) =>
          listener(event).pipe(Effect.catchCause(() => Effect.void)),
        { discard: true },
      );

    const getSession = (sessionId: string) =>
      SynchronizedRef.get(stateRef).pipe(
        Effect.map((state) => state.sessions.get(sessionId)),
      );

    const abortSession: ArmyCoordinatorShape["abortSession"] = (
      sessionId,
      cause,
    ) =>
      Effect.gen(function* () {
        const removed = yield* SynchronizedRef.modify(
          stateRef,
          (
            state,
          ): readonly [ArmySessionState | undefined, CoordinatorState] => {
            const session = state.sessions.get(sessionId);
            if (session === undefined) return [undefined, state];

            const sessions = new Map(state.sessions);
            sessions.delete(sessionId);
            const activeSessionByConfig = new Map(state.activeSessionByConfig);
            if (activeSessionByConfig.get(session.configName) === sessionId) {
              activeSessionByConfig.delete(session.configName);
            }
            const participantSessions = new Map(state.participantSessions);
            for (const participant of session.participants.values()) {
              if (participantSessions.get(participant.id) === sessionId) {
                participantSessions.delete(participant.id);
              }
            }

            return [
              session,
              {
                ...state,
                activeSessionByConfig,
                participantSessions,
                sessions,
              },
            ];
          },
        );
        if (removed === undefined) return;

        const error = sessionError("aborted", cause.reason, sessionId);
        yield* Deferred.fail(removed.startGate, error);
        yield* Effect.forEach(
          removed.checkpoints.values(),
          (checkpoint) =>
            Deferred.fail(
              checkpoint.gate as Deferred.Deferred<
                unknown,
                ArmyCoordinatorError
              >,
              error,
            ),
          { concurrency: "unbounded", discard: true },
        );
        const endedAtMs = Date.now();
        const logData = {
          cause,
          configName: removed.configName,
          durationMs: endedAtMs - (removed.startedAtMs ?? removed.createdAtMs),
          lastCompletedStep: lastCompletedStep(removed),
          room: removed.room,
          roster: rosterSnapshot(removed),
          sessionId,
          status: removed.status,
          ...(isNormalSessionEnd(cause)
            ? {}
            : { checkpoints: checkpointSnapshot(removed) }),
        };
        const writeEndLog = isNormalSessionEnd(cause)
          ? observability.info("army", "Army session ended", logData)
          : observability.warn("army", "Army session ended", logData);
        yield* publishSessionEnded({
          participantIds: [...removed.participants.values()].map(
            (participant) => participant.id,
          ),
          reason: cause.reason,
          sessionId,
        });
        yield* writeLifecycleLog(writeEndLog);
      });

    const abortParticipant: ArmyCoordinatorShape["abortParticipant"] = (
      participantId,
      cause,
    ) =>
      SynchronizedRef.get(stateRef).pipe(
        Effect.map((state) => state.participantSessions.get(participantId)),
        Effect.flatMap((sessionId) =>
          sessionId === undefined
            ? Effect.void
            : abortSession(sessionId, cause),
        ),
      );

    const authenticateParticipant = (
      sessionId: string,
      participantId: ArmyParticipantId,
    ): Effect.Effect<
      readonly [ArmySessionState, string],
      ArmyCoordinatorError
    > =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId);
        if (session === undefined) {
          return yield* sessionError(
            "inactive",
            "Army session is not active",
            sessionId,
          );
        }
        if (session.status !== "active") {
          return yield* sessionError(
            "not-started",
            "Army session has not started",
            sessionId,
          );
        }
        const participant = findParticipant(session, participantId);
        if (participant === undefined) {
          return yield* participantError(
            "sender-mismatch",
            "Army sender is not attached to this session",
            sessionId,
          );
        }
        return [session, participant[0]] as const;
      });

    const requireParticipant: ArmyCoordinatorShape["requireParticipant"] = (
      sessionId,
      participantId,
    ) =>
      authenticateParticipant(sessionId, participantId).pipe(
        Effect.map(([session, playerKey]) => ({
          playerCount: session.players.length,
          playerName: canonicalPlayerName(session, playerKey),
          playerNumber: playerNumber(session, playerKey),
          sessionId,
        })),
      );

    const awaitWithTimeout = <A>(args: {
      readonly effect: Effect.Effect<A, ArmyCoordinatorError>;
      readonly interruptCause: ArmySessionEndCause;
      readonly onTimeout: () => Effect.Effect<A, ArmyCoordinatorError>;
      readonly sessionId: string;
      readonly timeoutMs: number;
    }): Effect.Effect<A, ArmyCoordinatorError> =>
      args.effect.pipe(
        Effect.timeoutOrElse({
          duration: args.timeoutMs,
          orElse: args.onTimeout,
        }),
        // A canceled waiter makes a roster-wide checkpoint impossible to
        // complete, so interruption releases every peer by ending the session.
        Effect.onInterrupt(() =>
          abortSession(args.sessionId, args.interruptCause),
        ),
      );

    const join: ArmyCoordinatorShape["join"] = (
      config,
      requestedPlayerName,
      participantId,
    ) =>
      Effect.gen(function* () {
        const playerKey = normalizeArmyPlayerKey(requestedPlayerName);

        const outcome = yield* SynchronizedRef.modifyEffect<
          CoordinatorState,
          JoinOutcome,
          never,
          never
        >(
          stateRef,
          (state): Effect.Effect<readonly [JoinOutcome, CoordinatorState]> =>
            Effect.gen(function* () {
              let session =
                state.activeSessionByConfig.get(config.configName) === undefined
                  ? undefined
                  : state.sessions.get(
                      state.activeSessionByConfig.get(config.configName)!,
                    );
              let nextState = state;

              if (session === undefined) {
                const sessionId = `${Date.now().toString(36)}-${state.nextSessionId}`;
                const startGate = yield* Deferred.make<
                  void,
                  ArmyCoordinatorError
                >();
                session = {
                  ...config,
                  checkpoints: new Map(),
                  completedSteps: new Set(),
                  createdAtMs: Date.now(),
                  participants: new Map(),
                  playerKeys: new Set(
                    config.players.map(normalizeArmyPlayerKey),
                  ),
                  sessionId,
                  signatures: new Map(),
                  startedAtMs: null,
                  startGate,
                  status: "collecting",
                };
                nextState = {
                  ...state,
                  activeSessionByConfig: new Map(
                    state.activeSessionByConfig,
                  ).set(config.configName, sessionId),
                  nextSessionId: state.nextSessionId + 1,
                  sessions: new Map(state.sessions).set(sessionId, session),
                };
              }

              if (!session.playerKeys.has(playerKey)) {
                const error = participantError(
                  "not-configured",
                  `Player is not in army config: ${requestedPlayerName}`,
                  session.sessionId,
                  requestedPlayerName,
                );
                return [{ type: "reject" as const, error }, nextState] as const;
              }

              const boundSessionId =
                nextState.participantSessions.get(participantId);
              if (
                boundSessionId !== undefined &&
                boundSessionId !== session.sessionId
              ) {
                const error = participantError(
                  "already-joined",
                  "Army window is already attached to another session",
                  boundSessionId,
                  requestedPlayerName,
                );
                return [{ type: "reject" as const, error }, nextState] as const;
              }

              const existing = session.participants.get(playerKey);
              if (existing !== undefined && existing.id !== participantId) {
                const error = participantError(
                  "already-joined",
                  `Army player already joined: ${requestedPlayerName}`,
                  session.sessionId,
                  requestedPlayerName,
                );
                return [{ type: "reject" as const, error }, nextState] as const;
              }

              const participants = new Map(session.participants);
              participants.set(playerKey, {
                id: participantId,
                playerName: canonicalPlayerName(session, playerKey),
              });
              const activated =
                session.status === "collecting" &&
                participants.size === session.players.length;
              const updated: ArmySessionState = {
                ...session,
                participants,
                startedAtMs: activated ? Date.now() : session.startedAtMs,
                status: activated ? "active" : session.status,
              };
              const sessions = new Map(nextState.sessions).set(
                session.sessionId,
                updated,
              );
              const participantSessions = new Map(
                nextState.participantSessions,
              ).set(participantId, session.sessionId);

              return [
                {
                  type: "wait" as const,
                  activated,
                  playerKey,
                  session: updated,
                },
                { ...nextState, participantSessions, sessions },
              ] as const;
            }),
        );

        if (outcome.type === "reject") return yield* outcome.error;
        if (outcome.activated) {
          yield* Deferred.succeed(outcome.session.startGate, undefined);
          yield* writeLifecycleLog(
            observability.info("army", "Army session started", {
              configName: outcome.session.configName,
              room: outcome.session.room,
              roster: rosterSnapshot(outcome.session),
              sessionId: outcome.session.sessionId,
            }),
          );
        }

        const startTimeout = sessionError(
          "start-timeout",
          `Timed out waiting for army players`,
          outcome.session.sessionId,
        );
        yield* awaitWithTimeout({
          effect: Deferred.await(outcome.session.startGate),
          interruptCause: {
            kind: "interrupted",
            reason: "Army start interrupted",
          },
          sessionId: outcome.session.sessionId,
          timeoutMs: ARMY_START_TIMEOUT_MS,
          onTimeout: () =>
            abortSession(outcome.session.sessionId, {
              kind: "start-timeout",
              reason: startTimeout.message,
            }).pipe(Effect.andThen(Effect.fail(startTimeout))),
        });
        return toPayload(outcome.session, outcome.playerKey);
      });

    const registerBarrier = (
      sessionId: string,
      playerKey: string,
      signature: StepSignature,
      step: number,
    ) =>
      SynchronizedRef.modifyEffect<
        CoordinatorState,
        BarrierOutcome,
        never,
        never
      >(stateRef, (state) =>
        Effect.gen(function* () {
          const session = state.sessions.get(sessionId);
          if (session === undefined) {
            return [
              {
                type: "reject" as const,
                error: sessionError(
                  "inactive",
                  "Army session is not active",
                  sessionId,
                ),
              },
              state,
            ] as const;
          }
          if (session.completedSteps.has(step)) {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "completed-step",
                  `Army step ${step} has already completed`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          }
          const expected = session.signatures.get(step);
          if (expected !== undefined && !sameSignature(expected, signature)) {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "signature-mismatch",
                  `Army step mismatch for step ${step}: expected ${signatureDescription(expected)}, got ${signatureDescription(signature)}`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          }

          const existing = session.checkpoints.get(step);
          let checkpoint: BarrierCheckpoint;
          if (existing === undefined) {
            checkpoint = {
              arrived: new Set(),
              gate: yield* Deferred.make<void, ArmyCoordinatorError>(),
              kind: "barrier",
              signature,
            };
          } else if (existing.kind !== "barrier") {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "signature-mismatch",
                  `Army step mismatch for step ${step}: expected progress, got barrier`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          } else {
            checkpoint = existing;
          }

          if (checkpoint.arrived.has(playerKey)) {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "duplicate-arrival",
                  `Army player already reached sync ${step}: ${canonicalPlayerName(session, playerKey)}`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          }

          const arrived = new Set(checkpoint.arrived).add(playerKey);
          const complete = arrived.size === session.players.length;
          const checkpoints = new Map(session.checkpoints);
          if (complete) checkpoints.delete(step);
          else checkpoints.set(step, { ...checkpoint, arrived });
          const completedSteps = new Set(session.completedSteps);
          if (complete) completedSteps.add(step);
          const updated: ArmySessionState = {
            ...session,
            checkpoints,
            completedSteps,
            signatures: new Map(session.signatures).set(step, signature),
          };
          return [
            { type: "wait" as const, complete, gate: checkpoint.gate },
            {
              ...state,
              sessions: new Map(state.sessions).set(sessionId, updated),
            },
          ] as const;
        }),
      );

    const registerProgress = (
      sessionId: string,
      playerKey: string,
      signature: StepSignature,
      step: number,
      playerComplete: boolean,
    ) =>
      SynchronizedRef.modifyEffect<
        CoordinatorState,
        ProgressOutcome,
        never,
        never
      >(stateRef, (state) =>
        Effect.gen(function* () {
          const session = state.sessions.get(sessionId);
          if (session === undefined) {
            return [
              {
                type: "reject" as const,
                error: sessionError(
                  "inactive",
                  "Army session is not active",
                  sessionId,
                ),
              },
              state,
            ] as const;
          }
          if (session.completedSteps.has(step)) {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "completed-step",
                  `Army step ${step} has already completed`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          }
          const expected = session.signatures.get(step);
          if (expected !== undefined && !sameSignature(expected, signature)) {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "signature-mismatch",
                  `Army step mismatch for step ${step}: expected ${signatureDescription(expected)}, got ${signatureDescription(signature)}`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          }

          const existing = session.checkpoints.get(step);
          let checkpoint: ProgressCheckpoint;
          if (existing === undefined) {
            checkpoint = {
              arrived: new Map(),
              gate: yield* Deferred.make<
                ArmyProgressResult,
                ArmyCoordinatorError
              >(),
              kind: "progress",
              signature,
            };
          } else if (existing.kind !== "progress") {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "signature-mismatch",
                  `Army step mismatch for step ${step}: expected barrier, got progress`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          } else {
            checkpoint = existing;
          }

          if (checkpoint.arrived.has(playerKey)) {
            return [
              {
                type: "reject" as const,
                error: syncError(
                  "duplicate-arrival",
                  `Army player already reached progress ${step}: ${canonicalPlayerName(session, playerKey)}`,
                  sessionId,
                  step,
                  signature.label,
                ),
              },
              state,
            ] as const;
          }

          const arrived = new Map(checkpoint.arrived).set(
            playerKey,
            playerComplete,
          );
          const roundComplete = arrived.size === session.players.length;
          let result: ArmyProgressResult | undefined;
          if (roundComplete) {
            const completedPlayers = session.players.filter(
              (player) => arrived.get(normalizeArmyPlayerKey(player)) === true,
            );
            const pendingPlayers = session.players.filter(
              (player) => arrived.get(normalizeArmyPlayerKey(player)) !== true,
            );
            result = {
              complete: pendingPlayers.length === 0,
              completedPlayers,
              pendingPlayers,
            };
          }

          const checkpoints = new Map(session.checkpoints);
          if (roundComplete) checkpoints.delete(step);
          else checkpoints.set(step, { ...checkpoint, arrived });
          const completedSteps = new Set(session.completedSteps);
          if (result?.complete === true) completedSteps.add(step);
          const updated: ArmySessionState = {
            ...session,
            checkpoints,
            completedSteps,
            signatures: new Map(session.signatures).set(step, signature),
          };
          return [
            {
              type: "wait" as const,
              gate: checkpoint.gate,
              ...(result === undefined ? {} : { result }),
            },
            {
              ...state,
              sessions: new Map(state.sessions).set(sessionId, updated),
            },
          ] as const;
        }),
      );

    const checkpointTimeout = <A>(
      sessionId: string,
      step: number,
      label: string,
      kind: "progress" | "sync",
    ): Effect.Effect<A, ArmyCoordinatorError> =>
      Effect.gen(function* () {
        const session = yield* getSession(sessionId);
        const checkpoint = session?.checkpoints.get(step);
        const arrived =
          checkpoint?.kind === "barrier"
            ? checkpoint.arrived
            : new Set(checkpoint?.arrived.keys() ?? []);
        const missing =
          session === undefined ? [] : missingPlayers(session, arrived);
        const error = syncError(
          "timeout",
          `Timed out waiting for army ${kind} ${step} (${label}); missing: ${missing.join(", ")}`,
          sessionId,
          step,
          label,
        );
        yield* abortSession(sessionId, {
          kind: "checkpoint-timeout",
          reason: error.message,
        });
        return yield* error;
      });

    const sync: ArmyCoordinatorShape["sync"] = (
      sessionId,
      participantId,
      payload,
    ) =>
      Effect.gen(function* () {
        if (!Number.isSafeInteger(payload.step) || payload.step < 0) {
          return yield* syncError(
            "invalid-step",
            "Army step must be a non-negative safe integer",
            sessionId,
            payload.step,
            payload.label,
          );
        }
        const [, playerKey] = yield* authenticateParticipant(
          sessionId,
          participantId,
        );
        const signature: StepSignature = {
          kind: "barrier",
          label: normalizeLabel(payload.label),
          timeoutMs: normalizeTimeout(payload.timeoutMs),
        };
        const outcome = yield* registerBarrier(
          sessionId,
          playerKey,
          signature,
          payload.step,
        );
        if (outcome.type === "reject") {
          yield* abortSession(sessionId, {
            kind: "synchronization-error",
            reason: outcome.error.message,
          });
          return yield* outcome.error;
        }
        if (outcome.complete) yield* Deferred.succeed(outcome.gate, undefined);
        yield* awaitWithTimeout({
          effect: Deferred.await(outcome.gate),
          interruptCause: {
            kind: "interrupted",
            reason: "Army sync interrupted",
          },
          sessionId,
          timeoutMs: signature.timeoutMs,
          onTimeout: () =>
            checkpointTimeout<void>(
              sessionId,
              payload.step,
              signature.label,
              "sync",
            ),
        });
      });

    const progress: ArmyCoordinatorShape["progress"] = (
      sessionId,
      participantId,
      payload,
    ) =>
      Effect.gen(function* () {
        if (!Number.isSafeInteger(payload.step) || payload.step < 0) {
          return yield* syncError(
            "invalid-step",
            "Army step must be a non-negative safe integer",
            sessionId,
            payload.step,
            payload.label,
          );
        }
        const [, playerKey] = yield* authenticateParticipant(
          sessionId,
          participantId,
        );
        const signature: StepSignature = {
          kind: "progress",
          label: normalizeLabel(payload.label),
          timeoutMs: normalizeTimeout(payload.timeoutMs),
        };
        const outcome = yield* registerProgress(
          sessionId,
          playerKey,
          signature,
          payload.step,
          payload.complete,
        );
        if (outcome.type === "reject") {
          yield* abortSession(sessionId, {
            kind: "synchronization-error",
            reason: outcome.error.message,
          });
          return yield* outcome.error;
        }
        if (outcome.result !== undefined) {
          yield* Deferred.succeed(outcome.gate, outcome.result);
        }
        return yield* awaitWithTimeout({
          effect: Deferred.await(outcome.gate),
          interruptCause: {
            kind: "interrupted",
            reason: "Army progress interrupted",
          },
          sessionId,
          timeoutMs: signature.timeoutMs,
          onTimeout: () =>
            checkpointTimeout<ArmyProgressResult>(
              sessionId,
              payload.step,
              signature.label,
              "progress",
            ),
        });
      });

    const leave: ArmyCoordinatorShape["leave"] = (sessionId, participantId) =>
      Effect.gen(function* () {
        const [session, playerKey] = yield* authenticateParticipant(
          sessionId,
          participantId,
        );
        const playerName = canonicalPlayerName(session, playerKey);
        yield* abortSession(sessionId, {
          kind: "participant-left",
          reason: `Army player left: ${playerName}`,
        });
      });

    const fail: ArmyCoordinatorShape["fail"] = (
      sessionId,
      participantId,
      reason,
    ) =>
      Effect.gen(function* () {
        const [session, playerKey] = yield* authenticateParticipant(
          sessionId,
          participantId,
        );
        const playerName = canonicalPlayerName(session, playerKey);
        yield* abortSession(sessionId, {
          kind: "participant-failed",
          reason: `Army failed for ${playerName}: ${reason}`,
        });
      });

    const getSessions: ArmyCoordinatorShape["getSessions"] = () =>
      SynchronizedRef.get(stateRef).pipe(
        Effect.map((state) => [...state.sessions.values()]),
      );

    const service: ArmyCoordinatorShape = {
      abortParticipant,
      abortSession,
      fail,
      getSessions,
      join,
      leave,
      onSessionEnded,
      progress,
      requireParticipant,
      sync,
    };

    yield* Effect.addFinalizer(() =>
      service.getSessions().pipe(
        Effect.flatMap((sessions) =>
          Effect.forEach(
            sessions,
            (session) =>
              service.abortSession(session.sessionId, {
                kind: "application-quit",
                reason: "Application is quitting",
              }),
            { discard: true },
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            sessionEndedListeners.clear();
          }),
        ),
      ),
    );

    return service;
  });

export const layer = Layer.effect(
  ArmyCoordinator,
  Effect.gen(function* () {
    const observability = yield* DesktopObservability;
    return yield* makeArmyCoordinator(observability);
  }),
);
