import type {
  ArmyLoopTauntCommandPayload,
  ArmyLoopTauntMapIdentity,
  ArmyLoopTauntReport,
  ArmyLoopTauntStrategy,
  ArmySessionEndedPayload,
} from "@lucent/core/army";
import type { MonsterQuery, PlayerSnapshot } from "@lucent/game";
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Option,
  Queue,
  Ref,
  Scope,
  Semaphore,
  SynchronizedRef,
} from "effect";

import type { DesktopArmyBridge } from "../../../shared/desktopBridge";
import type { ApiService } from "../flash/api/Api";
import {
  CONSUMABLE_CAST_CONFIRMATION_TIMEOUT_MS,
  ConsumableCastDispatchDeadline,
} from "../flash/api/Combat";
import type { Event } from "../flash/contract/Event";

const LOOP_TAUNT_SCROLL_ITEM_ID = 12_917; // Scroll of Enrage
const LOOP_TAUNT_SCROLL_SKILL = 5;
const LOOP_TAUNT_STATUS_INTERVAL_MS = 250;
const LOOP_TAUNT_TARGET_INTERVAL_MS = 500;
const LOOP_TAUNT_SKIP_TIMEOUT_MS = 1_000;
const LOOP_TAUNT_COMMAND_REPORT_MARGIN_MS = 250;
const LOOP_TAUNT_CAST_LEASE_MS =
  CONSUMABLE_CAST_CONFIRMATION_TIMEOUT_MS + LOOP_TAUNT_COMMAND_REPORT_MARGIN_MS;
const LOOP_TAUNT_FOCUS_AURA_NAME = "focus";
const LOOP_TAUNT_FOCUS_AURA_ICON = "iwd1,ied1";

export type { ArmyLoopTauntStrategy };

/** Identifies an assigned Army player and its point-in-time projected state. */
export interface ArmyLoopTauntParticipantSnapshot {
  /** One-based position in the active Army roster. */
  readonly playerNumber: number;
  /** Point-in-time player state captured immediately before this attempt. */
  readonly player: PlayerSnapshot;
}

/** Projected state available when deciding whether to yield a taunt attempt. */
export interface ArmyLoopTauntSkipContext {
  /** Snapshots for the players assigned to this target. */
  readonly participants: readonly ArmyLoopTauntParticipantSnapshot[];
  /** The assigned participant selected for this attempt. */
  readonly self: ArmyLoopTauntParticipantSnapshot;
}

/** Returns true when the selected player should yield to the next participant. */
export type ArmyLoopTauntSkipWhen = (
  context: ArmyLoopTauntSkipContext,
) =>
  | boolean
  | Effect.Effect<boolean, unknown>
  | Generator<Effect.Effect<any, any, never>, boolean, any>;

export type ArmyLoopTauntRuntimeSkipWhen = (
  context: ArmyLoopTauntSkipContext,
) => Effect.Effect<boolean, unknown>;

/** Assigns one target to the Army players allowed to keep it taunted. */
export interface ArmyLoopTauntAssignment {
  /** One-based player numbers from the active Army roster. */
  readonly players: readonly number[];
  /** Skips the selected player's attempt when the callback returns true. */
  readonly skipWhen?: ArmyLoopTauntSkipWhen;
  /** The event that starts each taunt attempt. */
  readonly strategy: ArmyLoopTauntStrategy;
  /** The monster this assignment may taunt. */
  readonly target: MonsterQuery;
}

export interface ArmyLoopTauntRuntimeAssignment extends Omit<
  ArmyLoopTauntAssignment,
  "skipWhen"
> {
  readonly skipWhen?: ArmyLoopTauntRuntimeSkipWhen;
}

/** Stops a Loop Taunt run early; map and script lifecycle changes stop it automatically. */
export interface ArmyLoopTauntHandle {
  /** Stops this run. Repeated calls are safe. */
  stop(): Effect.Effect<void>;
}

export class ArmyLoopTauntError extends Error {
  readonly _tag = "ArmyLoopTauntError";

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ArmyLoopTauntError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: true,
      });
    }
  }
}

interface LoopTauntSession {
  readonly playerNumber: number;
  readonly players: readonly string[];
  readonly sessionId: string;
}

interface NormalizedLoopTauntAssignment {
  readonly assignmentId: number;
  readonly players: readonly number[];
  readonly query: MonsterQuery;
  readonly skipWhen?: ArmyLoopTauntRuntimeSkipWhen;
  readonly strategy: ArmyLoopTauntStrategy;
}

interface LocalLoopTauntTarget extends NormalizedLoopTauntAssignment {
  readonly alive: boolean;
  readonly focusActive: boolean;
  readonly lifeRevision: number;
  readonly monsterMapId: number;
}

interface LoopTauntRun {
  readonly runId: string;
  readonly sessionId: string;
}

interface ActiveLoopTaunt {
  readonly done: Deferred.Deferred<void>;
  readonly ended: Deferred.Deferred<never, ArmyLoopTauntError>;
  readonly handle: ArmyLoopTauntHandle;
  readonly sessionId: string;
  readonly started: Ref.Ref<boolean>;
  readonly stopRequested: Deferred.Deferred<string>;
  readonly token: number;
}

const matchesTauntCommand = (
  target: LocalLoopTauntTarget | undefined,
  command: Extract<
    ArmyLoopTauntCommandPayload["command"],
    { readonly type: "taunt" }
  >,
  playerNumber: number,
): target is LocalLoopTauntTarget =>
  target?.alive === true &&
  target.players.includes(playerNumber) &&
  target.monsterMapId === command.monsterMapId &&
  target.lifeRevision === command.lifeRevision &&
  (target.strategy.type !== "focus" || !target.focusActive);

const stopRecord = (
  active: ActiveLoopTaunt,
  reason: string,
): Effect.Effect<void> =>
  Deferred.succeed(active.stopRequested, reason).pipe(
    Effect.andThen(
      Ref.get(active.started).pipe(
        Effect.flatMap((started) =>
          started ? Deferred.await(active.done) : Effect.void,
        ),
      ),
    ),
    Effect.asVoid,
  );

const normalizeText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const causeMessage = (cause: Cause.Cause<unknown>): string => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error && squashed.message.trim() !== ""
    ? squashed.message
    : Cause.pretty(cause);
};

const fromDesktop = <A>(label: string, promise: () => Promise<A>) =>
  Effect.tryPromise({
    try: promise,
    catch: (cause) => new ArmyLoopTauntError(label, cause),
  });

const failValidation = (message: string): never => {
  throw new ArmyLoopTauntError(message);
};

const normalizeAssignments = (
  assignments: readonly ArmyLoopTauntRuntimeAssignment[],
  playerCount: number,
): readonly NormalizedLoopTauntAssignment[] => {
  if (assignments.length === 0) {
    failValidation("Loop Taunt requires at least one assignment");
  }

  const assignedPlayers = new Set<number>();
  return assignments.map((assignment, assignmentId) => {
    if (assignment.players.length === 0) {
      failValidation(
        `Loop Taunt assignment ${assignmentId + 1} requires at least one player`,
      );
    }

    const players = [...assignment.players].toSorted(
      (left, right) => left - right,
    );
    const localPlayers = new Set<number>();
    for (const player of players) {
      if (!Number.isSafeInteger(player) || player < 1 || player > playerCount) {
        failValidation(
          `Loop Taunt assignment ${assignmentId + 1} contains an invalid Army player number: ${player}`,
        );
      }
      if (localPlayers.has(player)) {
        failValidation(
          `Loop Taunt assignment ${assignmentId + 1} contains player ${player} more than once`,
        );
      }
      if (assignedPlayers.has(player)) {
        failValidation(
          `Loop Taunt player ${player} cannot be assigned to more than one target`,
        );
      }
      localPlayers.add(player);
      assignedPlayers.add(player);
    }

    const strategy: ArmyLoopTauntStrategy =
      assignment.strategy.type === "focus"
        ? { type: "focus" }
        : {
            message: assignment.strategy.message.trim(),
            type: "message",
          };
    if (strategy.type === "message" && strategy.message === "") {
      failValidation(
        `Loop Taunt assignment ${assignmentId + 1} requires a non-empty message`,
      );
    }
    return {
      assignmentId,
      players,
      query: assignment.target,
      ...(assignment.skipWhen === undefined
        ? {}
        : { skipWhen: assignment.skipWhen }),
      strategy,
    };
  });
};

const isFocusAura = (aura: {
  readonly icon: string | undefined;
  readonly name: string;
}): boolean =>
  normalizeText(aura.name) === LOOP_TAUNT_FOCUS_AURA_NAME &&
  aura.icon === LOOP_TAUNT_FOCUS_AURA_ICON;

const isFocusName = (name: string): boolean =>
  normalizeText(name) === LOOP_TAUNT_FOCUS_AURA_NAME;

const reportFailure = (cause: Cause.Cause<unknown>): ArmyLoopTauntReport => ({
  reason: causeMessage(cause),
  type: "failed",
});

const startupError = (cause: Cause.Cause<unknown>): ArmyLoopTauntError => {
  const error = Cause.squash(cause);
  return error instanceof ArmyLoopTauntError
    ? error
    : new ArmyLoopTauntError("Failed to start Loop Taunt", error);
};

const sameMap = (
  left: ArmyLoopTauntMapIdentity,
  right: ArmyLoopTauntMapIdentity,
): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.roomNumber === right.roomNumber;

export interface ArmyLoopTauntRuntime {
  readonly notifySessionEnded: (
    payload: ArmySessionEndedPayload,
  ) => Effect.Effect<void>;
  readonly startLoopTaunt: (
    assignments: readonly ArmyLoopTauntRuntimeAssignment[],
    onFailure: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  ) => Effect.Effect<ArmyLoopTauntHandle, ArmyLoopTauntError>;
  readonly stopActive: (reason?: string) => Effect.Effect<void>;
}

export const makeArmyLoopTauntRuntime = (
  api: ApiService,
  bridge: DesktopArmyBridge | undefined,
  getSession: () => Effect.Effect<LoopTauntSession | null>,
): Effect.Effect<ArmyLoopTauntRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const activeRef = yield* SynchronizedRef.make<ActiveLoopTaunt | null>(null);
    const lifecycle = yield* Semaphore.make(1);
    const nextTokenRef = yield* Ref.make(0);
    const runFork = Effect.runForkWith(yield* Effect.context<never>());

    const stopActive = (reason = "Loop Taunt stopped") =>
      SynchronizedRef.get(activeRef).pipe(
        Effect.flatMap((active) =>
          active === null ? Effect.void : stopRecord(active, reason),
        ),
      );

    const notifySessionEnded = (payload: ArmySessionEndedPayload) =>
      SynchronizedRef.get(activeRef).pipe(
        Effect.flatMap((active) =>
          active?.sessionId === payload.sessionId
            ? Deferred.fail(
                active.ended,
                new ArmyLoopTauntError(
                  `Army session ended while Loop Taunt was active: ${payload.reason}`,
                ),
              ).pipe(Effect.asVoid)
            : Effect.void,
        ),
      );

    const startLoopTaunt: ArmyLoopTauntRuntime["startLoopTaunt"] = (
      assignments,
      onFailure,
    ) =>
      lifecycle.withPermits(1)(
        Effect.gen(function* () {
          if (bridge === undefined) {
            return yield* Effect.fail(
              new ArmyLoopTauntError("Army bridge is unavailable"),
            );
          }

          const session = yield* getSession();
          if (session === null) {
            return yield* Effect.fail(
              new ArmyLoopTauntError("Army must be started before Loop Taunt"),
            );
          }

          const normalized = yield* Effect.try({
            try: () =>
              normalizeAssignments(assignments, session.players.length),
            catch: (cause) =>
              cause instanceof ArmyLoopTauntError
                ? cause
                : new ArmyLoopTauntError(
                    "Invalid Loop Taunt assignments",
                    cause,
                  ),
          });

          const previous = yield* SynchronizedRef.get(activeRef);
          if (previous !== null) {
            yield* stopRecord(previous, "Loop Taunt was replaced");
          }

          const token = yield* Ref.updateAndGet(
            nextTokenRef,
            (value) => value + 1,
          );
          const done = yield* Deferred.make<void>();
          const ended = yield* Deferred.make<never, ArmyLoopTauntError>();
          const ready = yield* Deferred.make<void, ArmyLoopTauntError>();
          const startedRef = yield* Ref.make(false);
          const stopRequested = yield* Deferred.make<string>();
          const handle: ArmyLoopTauntHandle = {
            stop: () =>
              Deferred.succeed(stopRequested, "Loop Taunt handle stopped").pipe(
                Effect.andThen(Deferred.await(done)),
                Effect.asVoid,
              ),
          };
          const active: ActiveLoopTaunt = {
            done,
            ended,
            handle,
            sessionId: session.sessionId,
            started: startedRef,
            stopRequested,
            token,
          };
          yield* SynchronizedRef.set(activeRef, active);

          const run = Effect.scoped(
            Effect.gen(function* () {
              const runScope = yield* Effect.scope;
              const startup = yield* Deferred.make<
                LoopTauntRun,
                ArmyLoopTauntError
              >();
              const mapExited = yield* Deferred.make<void>();

              const setup = Effect.gen(function* () {
                const mapIdentity: ArmyLoopTauntMapIdentity = yield* Effect.all(
                  {
                    id: api.map.getId(),
                    name: api.map.getName(),
                    roomNumber: api.map.getRoomNumber(),
                  },
                  { concurrency: "unbounded" },
                );

                const resolvedTargets = yield* Effect.forEach(
                  normalized,
                  (assignment) =>
                    api.monsters.get(assignment.query).pipe(
                      Effect.flatMap((monster) =>
                        monster === null
                          ? Effect.fail(
                              new ArmyLoopTauntError(
                                `Loop Taunt could not resolve assignment ${assignment.assignmentId + 1}`,
                              ),
                            )
                          : Effect.succeed<LocalLoopTauntTarget>({
                              ...assignment,
                              alive: monster.alive,
                              focusActive: monster.auras.some(isFocusAura),
                              lifeRevision: 0,
                              monsterMapId: monster.monsterMapId,
                            }),
                      ),
                    ),
                  { concurrency: "unbounded" },
                ).pipe(
                  Effect.mapError((cause) =>
                    cause instanceof ArmyLoopTauntError
                      ? cause
                      : new ArmyLoopTauntError(
                          "Failed to resolve Loop Taunt targets",
                          cause,
                        ),
                  ),
                );
                const duplicateTarget = resolvedTargets.find(
                  (target, index) =>
                    resolvedTargets.findIndex(
                      (candidate) =>
                        candidate.monsterMapId === target.monsterMapId,
                    ) !== index,
                );
                if (duplicateTarget !== undefined) {
                  return yield* Effect.fail(
                    new ArmyLoopTauntError(
                      "Loop Taunt assignments must resolve to different monsters",
                    ),
                  );
                }

                const targetsRef = yield* SynchronizedRef.make(
                  new Map(
                    resolvedTargets.map((target) => [
                      target.assignmentId,
                      target,
                    ]),
                  ),
                );
                const commandQueue =
                  yield* Queue.unbounded<ArmyLoopTauntCommandPayload>();
                const castPermit = yield* Semaphore.make(1);
                let registeredRun: LoopTauntRun | undefined;

                const disposeCommands = bridge.onLoopTauntCommand((command) => {
                  if (
                    command.sessionId === session.sessionId &&
                    (registeredRun === undefined ||
                      command.runId === registeredRun.runId)
                  ) {
                    runFork(
                      Queue.offer(commandQueue, command).pipe(Effect.asVoid),
                    );
                  }
                });
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    disposeCommands();
                  }),
                );

                const registration = yield* fromDesktop(
                  "Failed to register Loop Taunt",
                  () =>
                    bridge.loopTauntRegister({
                      assignments: resolvedTargets.map((assignment) => ({
                        assignmentId: assignment.assignmentId,
                        players: assignment.players,
                        strategy: assignment.strategy,
                        target: {
                          focusActive: assignment.focusActive,
                          lifeRevision: assignment.lifeRevision,
                          monsterMapId: assignment.monsterMapId,
                          state: assignment.alive ? "alive" : "dead",
                        },
                      })),
                      map: mapIdentity,
                      sessionId: session.sessionId,
                    }),
                );
                const loopRun: LoopTauntRun = {
                  runId: registration.runId,
                  sessionId: session.sessionId,
                };
                registeredRun = loopRun;
                yield* Effect.addFinalizer(() =>
                  fromDesktop("Failed to leave Loop Taunt", () =>
                    bridge.loopTauntLeave({
                      reason: "Renderer Loop Taunt ended",
                      ...loopRun,
                    }),
                  ).pipe(Effect.catchCause(() => Effect.void)),
                );

                const rosterReady = fromDesktop(
                  "Failed while waiting for the Army Loop Taunt roster",
                  () => bridge.loopTauntReady(loopRun),
                );
                const startupInterrupted = Effect.raceFirst(
                  Deferred.await(mapExited).pipe(
                    Effect.flatMap(() =>
                      Effect.fail(
                        new ArmyLoopTauntError(
                          "The map changed while Loop Taunt was starting",
                        ),
                      ),
                    ),
                  ),
                  Effect.raceFirst(
                    Deferred.await(stopRequested).pipe(
                      Effect.flatMap((reason) =>
                        Effect.fail(new ArmyLoopTauntError(reason)),
                      ),
                    ),
                    Deferred.await(ended),
                  ),
                );
                yield* Effect.raceFirst(rosterReady, startupInterrupted);

                const finalMapIdentity: ArmyLoopTauntMapIdentity =
                  yield* Effect.all(
                    {
                      id: api.map.getId(),
                      name: api.map.getName(),
                      roomNumber: api.map.getRoomNumber(),
                    },
                    { concurrency: "unbounded" },
                  );
                if (!sameMap(mapIdentity, finalMapIdentity)) {
                  return yield* Effect.fail(
                    new ArmyLoopTauntError(
                      "The map changed while Loop Taunt was starting",
                    ),
                  );
                }

                const report = (report: ArmyLoopTauntReport) =>
                  fromDesktop("Failed to report Loop Taunt state", () =>
                    bridge.loopTauntReport({ ...loopRun, report }),
                  );
                const reportBestEffort = (value: ArmyLoopTauntReport) =>
                  report(value).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning({
                        cause,
                        message: "Loop Taunt report failed",
                      }),
                    ),
                  );

                const refreshTarget = (
                  assignmentId: number,
                  reportUnchanged = false,
                ) =>
                  Effect.gen(function* () {
                    const current = (yield* SynchronizedRef.get(
                      targetsRef,
                    )).get(assignmentId);
                    if (current === undefined) return;
                    const monster = yield* api.monsters.get(current.query);
                    const refreshed = yield* SynchronizedRef.modify(
                      targetsRef,
                      (targets) => {
                        const target = targets.get(assignmentId);
                        if (target === undefined) {
                          return [undefined, targets] as const;
                        }
                        if (monster === null) {
                          if (!target.alive && !target.focusActive) {
                            return [
                              reportUnchanged ? target : undefined,
                              targets,
                            ] as const;
                          }
                          const unavailable: LocalLoopTauntTarget = {
                            ...target,
                            alive: false,
                            focusActive: false,
                          };
                          return [
                            unavailable,
                            new Map(targets).set(assignmentId, unavailable),
                          ] as const;
                        }

                        const alive = monster.alive;
                        const focusActive = monster.auras.some(isFocusAura);
                        const monsterMapId = monster.monsterMapId;
                        if (
                          target.alive === alive &&
                          target.focusActive === focusActive &&
                          target.monsterMapId === monsterMapId
                        ) {
                          return [
                            reportUnchanged ? target : undefined,
                            targets,
                          ] as const;
                        }
                        const next: LocalLoopTauntTarget = {
                          ...target,
                          alive,
                          focusActive,
                          lifeRevision:
                            target.lifeRevision +
                            (target.monsterMapId !== monsterMapId ||
                            (!target.alive && alive)
                              ? 1
                              : 0),
                          monsterMapId,
                        };
                        return [
                          next,
                          new Map(targets).set(assignmentId, next),
                        ] as const;
                      },
                    );
                    if (refreshed === undefined) return;
                    yield* reportBestEffort({
                      assignmentId,
                      focusActive: refreshed.focusActive,
                      lifeRevision: refreshed.lifeRevision,
                      monsterMapId: refreshed.monsterMapId,
                      state: refreshed.alive ? "alive" : "dead",
                      type: "target-state",
                    });
                  });

                const updateTargetState = (
                  assignmentId: number,
                  monsterMapId: number,
                  alive: boolean,
                ) =>
                  Effect.gen(function* () {
                    const changed = yield* SynchronizedRef.modify(
                      targetsRef,
                      (targets) => {
                        const target = targets.get(assignmentId);
                        if (
                          target === undefined ||
                          target.monsterMapId !== monsterMapId ||
                          (target.alive === alive &&
                            (alive || target.focusActive === false))
                        ) {
                          return [undefined, targets] as const;
                        }
                        const next: LocalLoopTauntTarget = {
                          ...target,
                          alive,
                          lifeRevision:
                            target.lifeRevision +
                            (alive && !target.alive ? 1 : 0),
                          ...(!alive || !target.alive
                            ? { focusActive: false }
                            : {}),
                        };
                        return [
                          next,
                          new Map(targets).set(assignmentId, next),
                        ] as const;
                      },
                    );
                    if (changed === undefined) return;
                    yield* reportBestEffort({
                      assignmentId,
                      focusActive: changed.focusActive,
                      lifeRevision: changed.lifeRevision,
                      monsterMapId,
                      state: alive ? "alive" : "dead",
                      type: "target-state",
                    });
                  });

                const updateFocusState = (
                  assignmentId: number,
                  monsterMapId: number,
                  active: boolean,
                ) =>
                  Effect.gen(function* () {
                    const changed = yield* SynchronizedRef.modify(
                      targetsRef,
                      (targets) => {
                        const target = targets.get(assignmentId);
                        if (
                          target === undefined ||
                          target.strategy.type !== "focus" ||
                          target.monsterMapId !== monsterMapId ||
                          target.focusActive === active
                        ) {
                          return [undefined, targets] as const;
                        }
                        const next = {
                          ...target,
                          focusActive: active,
                        };
                        return [
                          next,
                          new Map(targets).set(assignmentId, next),
                        ] as const;
                      },
                    );
                    if (changed === undefined) return;
                    yield* reportBestEffort({
                      active,
                      assignmentId,
                      lifeRevision: changed.lifeRevision,
                      monsterMapId,
                      type: "focus-state",
                    });
                  });

                const assignmentIdsForMonster = (monsterMapId: number) =>
                  SynchronizedRef.get(targetsRef).pipe(
                    Effect.map((targets) =>
                      [...targets.values()]
                        .filter(
                          (target) => target.monsterMapId === monsterMapId,
                        )
                        .map((target) => target.assignmentId),
                    ),
                  );

                const onEvent = (event: Event) =>
                  Effect.gen(function* () {
                    switch (event.type) {
                      case "monster-death":
                      case "monster-respawn": {
                        const assignmentIds = yield* assignmentIdsForMonster(
                          event.monsterMapId,
                        );
                        yield* Effect.forEach(
                          assignmentIds,
                          (assignmentId) =>
                            updateTargetState(
                              assignmentId,
                              event.monsterMapId,
                              event.type === "monster-respawn",
                            ),
                          { discard: true },
                        );
                        return;
                      }
                      case "aura-added":
                      case "aura-removed": {
                        if (
                          event.targetType !== "monster" ||
                          !isFocusName(event.name) ||
                          (event.type === "aura-added" &&
                            event.icon !== LOOP_TAUNT_FOCUS_AURA_ICON)
                        ) {
                          return;
                        }
                        const assignmentIds = yield* assignmentIdsForMonster(
                          event.targetId,
                        );
                        yield* Effect.forEach(
                          assignmentIds,
                          (assignmentId) =>
                            updateFocusState(
                              assignmentId,
                              event.targetId,
                              event.type === "aura-added",
                            ),
                          { discard: true },
                        );
                        return;
                      }
                      case "update-message": {
                        const targets = yield* SynchronizedRef.get(targetsRef);
                        const candidates =
                          event.monsterMapId === undefined
                            ? [...targets.values()]
                            : [...targets.values()].filter(
                                (target) =>
                                  target.monsterMapId === event.monsterMapId,
                              );
                        yield* Effect.forEach(
                          candidates.filter(
                            (target) => target.strategy.type === "message",
                          ),
                          (target) =>
                            reportBestEffort({
                              assignmentId: target.assignmentId,
                              lifeRevision: target.lifeRevision,
                              message: event.message,
                              monsterMapId: target.monsterMapId,
                              source: event.source,
                              type: "message",
                            }),
                          { discard: true },
                        );
                        return;
                      }
                    }
                  }).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning({
                        cause,
                        message: "Loop Taunt event handling failed",
                      }),
                    ),
                  );

                const disposeEvents = yield* api.events.on(undefined, onEvent);
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    disposeEvents();
                  }),
                );

                const participantState = Effect.gen(function* () {
                  const assigned = normalized.some((assignment) =>
                    assignment.players.includes(session.playerNumber),
                  );
                  const [alive, item, cooldownMs] = yield* Effect.all([
                    api.player.isAlive(),
                    api.combat.getConsumableSkillItem(),
                    api.combat.getSkillCooldownRemaining(
                      LOOP_TAUNT_SCROLL_SKILL,
                    ),
                  ]);
                  const scrollEquipped =
                    item?.itemId === LOOP_TAUNT_SCROLL_ITEM_ID;
                  return {
                    alive,
                    cooldownMs,
                    reason: !assigned
                      ? "not-assigned"
                      : !alive
                        ? "dead"
                        : !scrollEquipped
                          ? "scroll-not-equipped"
                          : cooldownMs > 0
                            ? "cooldown"
                            : undefined,
                    usable: assigned && alive && scrollEquipped,
                  };
                }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ArmyLoopTauntError(
                        "Failed to read Loop Taunt readiness",
                        cause,
                      ),
                  ),
                );

                const reportParticipantState = Effect.gen(function* () {
                  const state = yield* participantState;
                  yield* report({
                    alive: state.alive,
                    cooldownMs: state.cooldownMs,
                    ...(state.reason === undefined
                      ? {}
                      : { reason: state.reason }),
                    type: "participant-state",
                    usable: state.usable,
                  });
                });

                const reportCommandResult = (
                  commandId: number,
                  outcome:
                    | "confirmed"
                    | "target-unavailable"
                    | "cast-failed"
                    | "not-ready"
                    | "skipped",
                  details?: {
                    readonly cooldownMs?: number;
                    readonly reason?: string;
                  },
                ) =>
                  reportBestEffort({
                    commandId,
                    ...(details?.cooldownMs === undefined
                      ? {}
                      : { cooldownMs: details.cooldownMs }),
                    outcome,
                    ...(details?.reason === undefined
                      ? {}
                      : { reason: details.reason }),
                    type: "command-result",
                  });

                const executeCommand = (payload: ArmyLoopTauntCommandPayload) =>
                  Effect.gen(function* () {
                    if (
                      payload.sessionId !== loopRun.sessionId ||
                      payload.runId !== loopRun.runId
                    ) {
                      return;
                    }
                    const command = payload.command;
                    switch (command.type) {
                      case "probe":
                        yield* reportParticipantState.pipe(
                          Effect.catchCause((cause) =>
                            reportBestEffort(reportFailure(cause)),
                          ),
                        );
                        return;
                      case "diagnostic":
                        yield* Effect.logWarning({
                          assignmentId: command.assignmentId,
                          code: command.code,
                          message: command.message,
                          runId: loopRun.runId,
                        });
                        return;
                      case "taunt":
                        yield* castPermit.withPermits(1)(
                          Effect.gen(function* () {
                            const target = (yield* SynchronizedRef.get(
                              targetsRef,
                            )).get(command.assignmentId);
                            if (
                              !matchesTauntCommand(
                                target,
                                command,
                                session.playerNumber,
                              )
                            ) {
                              yield* reportCommandResult(
                                payload.commandId,
                                "target-unavailable",
                              );
                              return;
                            }

                            const readiness = yield* participantState;
                            if (!readiness.usable || readiness.cooldownMs > 0) {
                              yield* reportCommandResult(
                                payload.commandId,
                                "not-ready",
                                {
                                  cooldownMs: readiness.cooldownMs,
                                  ...(readiness.reason === undefined
                                    ? {}
                                    : { reason: readiness.reason }),
                                },
                              );
                              return;
                            }

                            let validatedTarget = target;
                            if (target.skipWhen !== undefined) {
                              const participantSnapshots =
                                yield* Effect.forEach(
                                  target.players,
                                  (playerNumber) =>
                                    api.players
                                      .get(session.players[playerNumber - 1]!)
                                      .pipe(
                                        Effect.map((player) =>
                                          player === null
                                            ? null
                                            : {
                                                player: player.toJSON(),
                                                playerNumber,
                                              },
                                        ),
                                      ),
                                  { concurrency: "unbounded" },
                                );
                              const unavailablePlayerNumbers =
                                target.players.filter(
                                  (_, index) =>
                                    participantSnapshots[index] === null,
                                );
                              if (unavailablePlayerNumbers.length > 0) {
                                yield* reportCommandResult(
                                  payload.commandId,
                                  "not-ready",
                                  {
                                    reason: `Army player snapshots unavailable: ${unavailablePlayerNumbers.join(", ")}`,
                                  },
                                );
                                return;
                              }

                              const snapshots = participantSnapshots.filter(
                                (
                                  participant,
                                ): participant is ArmyLoopTauntParticipantSnapshot =>
                                  participant !== null,
                              );
                              const self = snapshots.find(
                                ({ playerNumber }) =>
                                  playerNumber === session.playerNumber,
                              )!;
                              const callbackBudgetMs = Math.min(
                                LOOP_TAUNT_SKIP_TIMEOUT_MS,
                                command.expiresAt -
                                  (yield* Clock.currentTimeMillis) -
                                  LOOP_TAUNT_COMMAND_REPORT_MARGIN_MS,
                              );
                              if (callbackBudgetMs <= 0) {
                                yield* reportCommandResult(
                                  payload.commandId,
                                  "not-ready",
                                  {
                                    reason: "Loop Taunt command lease expired",
                                  },
                                );
                                return;
                              }
                              const leaseLimitedCallback =
                                callbackBudgetMs < LOOP_TAUNT_SKIP_TIMEOUT_MS;
                              const skip = yield* target
                                .skipWhen({
                                  participants: snapshots,
                                  self,
                                })
                                .pipe(
                                  Effect.timeoutOption(
                                    `${callbackBudgetMs} millis`,
                                  ),
                                );
                              if (Option.isNone(skip)) {
                                yield* reportCommandResult(
                                  payload.commandId,
                                  "not-ready",
                                  {
                                    reason: leaseLimitedCallback
                                      ? "Loop Taunt command lease expired"
                                      : "Loop Taunt skip callback timed out",
                                  },
                                );
                                return;
                              }
                              if (skip.value) {
                                yield* reportCommandResult(
                                  payload.commandId,
                                  "skipped",
                                );
                                return;
                              }

                              const refreshedTarget =
                                (yield* SynchronizedRef.get(targetsRef)).get(
                                  command.assignmentId,
                                );
                              if (
                                !matchesTauntCommand(
                                  refreshedTarget,
                                  command,
                                  session.playerNumber,
                                )
                              ) {
                                yield* reportCommandResult(
                                  payload.commandId,
                                  "target-unavailable",
                                );
                                return;
                              }
                              const currentReadiness = yield* participantState;
                              if (
                                !currentReadiness.usable ||
                                currentReadiness.cooldownMs > 0
                              ) {
                                yield* reportCommandResult(
                                  payload.commandId,
                                  "not-ready",
                                  {
                                    cooldownMs: currentReadiness.cooldownMs,
                                    ...(currentReadiness.reason === undefined
                                      ? {}
                                      : { reason: currentReadiness.reason }),
                                  },
                                );
                                return;
                              }
                              validatedTarget = refreshedTarget;
                            }

                            if (
                              command.expiresAt -
                                (yield* Clock.currentTimeMillis) <
                              LOOP_TAUNT_CAST_LEASE_MS
                            ) {
                              yield* reportCommandResult(
                                payload.commandId,
                                "not-ready",
                                {
                                  reason: "Loop Taunt command lease expired",
                                },
                              );
                              return;
                            }

                            const previousTarget =
                              yield* api.combat.target.get();
                            const result = yield* api.combat
                              .castConsumableOnMonster(
                                validatedTarget.monsterMapId,
                                LOOP_TAUNT_SCROLL_ITEM_ID,
                              )
                              .pipe(
                                Effect.provideService(
                                  ConsumableCastDispatchDeadline,
                                  command.expiresAt - LOOP_TAUNT_CAST_LEASE_MS,
                                ),
                                Effect.catchCause(() => Effect.succeed(null)),
                              );
                            const cooldownMs =
                              yield* api.combat.getSkillCooldownRemaining(
                                LOOP_TAUNT_SCROLL_SKILL,
                              );
                            const confirmed =
                              result?.success === true &&
                              result.monsterMapId ===
                                validatedTarget.monsterMapId;
                            yield* reportCommandResult(
                              payload.commandId,
                              confirmed ? "confirmed" : "cast-failed",
                              { cooldownMs },
                            );

                            const currentTarget =
                              yield* api.combat.target.get();
                            if (
                              previousTarget?.type === "monster" &&
                              previousTarget.monsterMapId !==
                                validatedTarget.monsterMapId &&
                              currentTarget?.type === "monster" &&
                              currentTarget.monsterMapId ===
                                validatedTarget.monsterMapId
                            ) {
                              yield* api.combat
                                .attackMonster(previousTarget.monsterMapId)
                                .pipe(
                                  Effect.catchCause(() =>
                                    Effect.succeed(false),
                                  ),
                                );
                            }
                          }),
                        );
                        return;
                    }
                  });

                yield* Effect.forever(
                  Queue.take(commandQueue).pipe(
                    Effect.flatMap(executeCommand),
                    Effect.catchCause((cause) =>
                      reportBestEffort(reportFailure(cause)),
                    ),
                  ),
                ).pipe(Effect.forkScoped);

                yield* Effect.forever(
                  reportParticipantState.pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning({
                        cause,
                        message: "Loop Taunt readiness report failed",
                      }),
                    ),
                    Effect.andThen(
                      Effect.sleep(`${LOOP_TAUNT_STATUS_INTERVAL_MS} millis`),
                    ),
                  ),
                ).pipe(Effect.forkScoped);

                yield* Effect.forever(
                  Effect.forEach(
                    normalized,
                    (assignment) =>
                      refreshTarget(assignment.assignmentId, true),
                    {
                      concurrency: "unbounded",
                      discard: true,
                    },
                  ).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning({
                        cause,
                        message: "Loop Taunt target refresh failed",
                      }),
                    ),
                    Effect.andThen(
                      Effect.sleep(`${LOOP_TAUNT_TARGET_INTERVAL_MS} millis`),
                    ),
                  ),
                ).pipe(Effect.forkScoped);

                return loopRun;
              });

              const mapWatcher = api.events
                .once(
                  { type: "join-map" },
                  {
                    trigger: setup.pipe(
                      Effect.matchCauseEffect({
                        onFailure: (cause) =>
                          Deferred.failCause(startup, cause).pipe(
                            Effect.asVoid,
                          ),
                        onSuccess: (loopRun) =>
                          Deferred.succeed(startup, loopRun).pipe(
                            Effect.asVoid,
                          ),
                      }),
                      Effect.forkIn(runScope, {
                        startImmediately: true,
                      }),
                      Effect.as(true),
                    ),
                  },
                )
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) =>
                      Deferred.failCause(startup, cause).pipe(Effect.asVoid),
                    onSuccess: () =>
                      Deferred.succeed(mapExited, undefined).pipe(
                        Effect.asVoid,
                      ),
                  }),
                  Effect.forkScoped,
                );
              yield* mapWatcher;

              const loopRun = yield* Deferred.await(startup);
              yield* Effect.yieldNow;
              if (yield* Deferred.isDone(mapExited)) {
                return yield* Effect.fail(
                  new ArmyLoopTauntError(
                    "The map changed while Loop Taunt was starting",
                  ),
                );
              }

              yield* Ref.set(startedRef, true);
              yield* Deferred.succeed(ready, undefined);

              const terminal = fromDesktop(
                "Loop Taunt orchestration failed",
                () => bridge.loopTauntAwait(loopRun),
              ).pipe(
                Effect.flatMap((result) =>
                  result.status === "failed"
                    ? Effect.fail(new ArmyLoopTauntError(result.reason))
                    : Effect.void,
                ),
              );
              yield* Effect.raceFirst(
                Deferred.await(mapExited),
                Effect.raceFirst(
                  Deferred.await(stopRequested),
                  Effect.raceFirst(Deferred.await(ended), terminal),
                ),
              ).pipe(
                Effect.tapCause((cause) =>
                  Deferred.isDone(stopRequested).pipe(
                    Effect.flatMap((stopping) =>
                      stopping
                        ? Effect.void
                        : fromDesktop(
                            "Failed to report Loop Taunt failure",
                            () =>
                              bridge.loopTauntReport({
                                ...loopRun,
                                report: reportFailure(cause),
                              }),
                          ).pipe(Effect.catchCause(() => Effect.void)),
                    ),
                  ),
                ),
              );
            }),
          );

          const clearActive = SynchronizedRef.update(activeRef, (current) =>
            current?.token === token ? null : current,
          );
          const finish = (cause?: Cause.Cause<unknown>) =>
            Effect.gen(function* () {
              const started = yield* Ref.get(startedRef);
              if (!started) {
                yield* Deferred.fail(
                  ready,
                  cause === undefined
                    ? new ArmyLoopTauntError(
                        "Loop Taunt stopped before startup completed",
                      )
                    : startupError(cause),
                );
              }
              yield* clearActive;
              yield* Deferred.succeed(done, undefined);

              const stopping = yield* Deferred.isDone(stopRequested);
              if (cause !== undefined && started && !stopping) {
                yield* Effect.sync(() => {
                  runFork(onFailure(cause));
                });
              }
            });

          yield* run.pipe(
            Effect.matchCauseEffect({
              onFailure: (cause) => finish(cause),
              onSuccess: () => finish(),
            }),
            Effect.forkIn(scope),
          );

          return yield* Deferred.await(ready).pipe(
            Effect.tapError(() => Deferred.await(done)),
            Effect.onInterrupt(() =>
              Deferred.succeed(
                stopRequested,
                "Loop Taunt startup was interrupted",
              ).pipe(Effect.asVoid),
            ),
            Effect.as(handle),
          );
        }),
      );

    yield* Effect.addFinalizer(() =>
      stopActive("Loop Taunt runtime is shutting down"),
    );

    return {
      notifySessionEnded,
      startLoopTaunt,
      stopActive,
    };
  });
