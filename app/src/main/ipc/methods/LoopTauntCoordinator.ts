import {
  type ArmyLoopTauntCommandPayload,
  type ArmyLoopTauntObservationPayload,
  type ArmyLoopTauntParticipantPayload,
  type ArmyLoopTauntStartPayload,
  type ArmyLoopTauntStopPayload,
  type ArmyLoopTauntTriggerPayload,
  type ArmyLoopTauntTriggerReason,
} from "../../../shared/ipc";
import {
  DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS,
  DEFAULT_LOOP_TAUNT_DELAY_MS,
  LOOP_TAUNT_FOCUS_AURA_ICON,
  LOOP_TAUNT_FOCUS_AURA_NAME,
  LOOP_TAUNT_RETRY_SETTLE_MS,
  LOOP_TAUNT_SHORT_RETRY_MS,
  LOOP_TAUNT_TURN_REPORT_TIMEOUT_MS,
} from "../../../shared/loop-taunt";

type LoopTauntPhase =
  | "idle"
  | "retry-settling"
  | "retry-wait"
  | "settling"
  | "waiting-report";

interface ActiveLoopTauntTurn {
  readonly attempt: number;
  readonly epoch: number;
  readonly exhaustedPlayerNumbers: Set<number>;
  readonly reason: string;
  readonly selected: ArmyLoopTauntParticipantPayload;
}

interface LoopTauntState {
  readonly id: string;
  readonly participants: readonly ArmyLoopTauntParticipantPayload[];
  readonly registeredPlayerKeys: Set<string>;
  readonly targetMonMapId: number;
  readonly timers: Set<ReturnType<typeof setTimeout> | (() => void)>;
  readonly trigger: ArmyLoopTauntTriggerPayload;
  currentTurn: ActiveLoopTauntTurn | undefined;
  epoch: number;
  focusActive: boolean;
  nextIndex: number;
  phase: LoopTauntPhase;
}

export interface LoopTauntCoordinatorOptions {
  readonly broadcastCommand: (command: ArmyLoopTauntCommandPayload) => void;
  readonly schedule?: (
    delayMs: number,
    callback: () => void,
  ) => ReturnType<typeof setTimeout> | (() => void);
  readonly sendCommand: (
    player: ArmyLoopTauntParticipantPayload,
    command: ArmyLoopTauntCommandPayload,
  ) => void;
  readonly sessionId: string;
}

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const isFocusAuraName = (auraName: string | undefined): boolean =>
  auraName === undefined ||
  normalizeKey(auraName) === normalizeKey(LOOP_TAUNT_FOCUS_AURA_NAME);

const isFocusAuraIcon = (auraIcon: string | undefined): boolean =>
  auraIcon === undefined || auraIcon === LOOP_TAUNT_FOCUS_AURA_ICON;

const isFocusObservation = (
  observation: ArmyLoopTauntObservationPayload,
): boolean =>
  isFocusAuraName(observation.auraName) &&
  isFocusAuraIcon(observation.auraIcon);

const clearTimers = (state: LoopTauntState): void => {
  for (const timer of state.timers) {
    if (typeof timer === "function") {
      timer();
    } else {
      clearTimeout(timer);
    }
  }
  state.timers.clear();
};

const resetTurn = (state: LoopTauntState): void => {
  clearTimers(state);
  state.currentTurn = undefined;
  state.phase = "idle";
  state.focusActive = true;
};

const commandReason = (reason: ArmyLoopTauntTriggerReason | string): string =>
  reason.replaceAll("-", " ");

export class LoopTauntCoordinator {
  private readonly loops = new Map<string, LoopTauntState>();

  public constructor(private readonly options: LoopTauntCoordinatorOptions) {}

  public clear(): void {
    for (const state of this.loops.values()) {
      clearTimers(state);
    }
    this.loops.clear();
  }

  public start(payload: ArmyLoopTauntStartPayload): void {
    const playerKey = normalizeKey(payload.playerName);
    const existing = this.loops.get(payload.id);
    if (existing) {
      existing.registeredPlayerKeys.add(playerKey);
      return;
    }

    this.loops.set(payload.id, {
      currentTurn: undefined,
      epoch: 0,
      focusActive: true,
      id: payload.id,
      nextIndex: 0,
      participants: payload.participants,
      phase: "idle",
      registeredPlayerKeys: new Set([playerKey]),
      targetMonMapId: payload.targetMonMapId,
      timers: new Set(),
      trigger: payload.trigger,
    });
  }

  public stop(payload: ArmyLoopTauntStopPayload): void {
    const state = this.loops.get(payload.id);
    if (!state) {
      return;
    }

    state.registeredPlayerKeys.delete(normalizeKey(payload.playerName));
    if (state.registeredPlayerKeys.size === 0) {
      clearTimers(state);
      this.loops.delete(payload.id);
    }
  }

  public observe(payload: ArmyLoopTauntObservationPayload): void {
    const state = this.loops.get(payload.id);
    if (!state || payload.targetMonMapId !== state.targetMonMapId) {
      return;
    }

    switch (payload.type) {
      case "focus-active":
        this.observeFocusActive(state, payload);
        return;
      case "target-dead":
        this.failLoop(state, "target monster died");
        return;
      case "trigger":
        this.observeTrigger(state, payload);
        return;
      case "turn-result":
        this.observeTurnResult(state, payload);
        return;
    }
  }

  private schedule(
    state: LoopTauntState,
    delayMs: number,
    callback: () => void,
  ): void {
    const schedule = this.options.schedule;
    const timer =
      schedule === undefined
        ? setTimeout(
            () => {
              state.timers.delete(timer);
              callback();
            },
            Math.max(0, Math.trunc(delayMs)),
          )
        : schedule(Math.max(0, Math.trunc(delayMs)), () => {
            state.timers.delete(timer);
            callback();
          });
    state.timers.add(timer);
  }

  private sendTurnCommand(
    state: LoopTauntState,
    turn: ActiveLoopTauntTurn,
  ): void {
    this.options.sendCommand(turn.selected, {
      attempt: turn.attempt,
      epoch: turn.epoch,
      id: state.id,
      reason: turn.reason,
      selected: turn.selected,
      sessionId: this.options.sessionId,
      targetMonMapId: state.targetMonMapId,
      trigger: state.trigger,
      type: "turn",
    });
  }

  private broadcastStop(state: LoopTauntState, reason: string): void {
    this.options.broadcastCommand({
      id: state.id,
      reason,
      sessionId: this.options.sessionId,
      type: "stop",
    });
  }

  private failLoop(state: LoopTauntState, reason: string): void {
    clearTimers(state);
    this.loops.delete(state.id);
    this.broadcastStop(state, reason);
  }

  private observeFocusActive(
    state: LoopTauntState,
    payload: ArmyLoopTauntObservationPayload,
  ): void {
    if (!isFocusObservation(payload)) {
      return;
    }

    state.focusActive = true;
    if (
      state.phase === "settling" ||
      state.phase === "retry-settling" ||
      state.phase === "retry-wait" ||
      state.phase === "waiting-report"
    ) {
      resetTurn(state);
    }
  }

  private observeTrigger(
    state: LoopTauntState,
    payload: ArmyLoopTauntObservationPayload,
  ): void {
    if (state.phase !== "idle") {
      return;
    }

    const triggerReason = payload.triggerReason;
    if (triggerReason === undefined) {
      return;
    }

    if (state.trigger.type === "focus") {
      if (
        triggerReason !== "focus-missing" &&
        triggerReason !== "focus-removed"
      ) {
        return;
      }

      if (!isFocusObservation(payload)) {
        return;
      }
    } else if (triggerReason !== "message-matched") {
      return;
    }

    this.startTurn(state, commandReason(triggerReason));
  }

  private observeTurnResult(
    state: LoopTauntState,
    payload: ArmyLoopTauntObservationPayload,
  ): void {
    const turn = state.currentTurn;
    if (
      turn === undefined ||
      payload.epoch !== turn.epoch ||
      payload.attempt !== turn.attempt ||
      state.phase !== "waiting-report"
    ) {
      return;
    }

    clearTimers(state);
    if (payload.eligible === false) {
      turn.exhaustedPlayerNumbers.add(turn.selected.number);
      this.advanceAfterIneligible(state, turn);
      return;
    }

    if (payload.eligible !== true) {
      return;
    }

    if (state.focusActive) {
      resetTurn(state);
      return;
    }

    state.phase = turn.attempt === 1 ? "settling" : "retry-settling";
    this.schedule(
      state,
      turn.attempt === 1
        ? DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS
        : LOOP_TAUNT_RETRY_SETTLE_MS,
      () => this.completeSettleWindow(state, turn),
    );
  }

  private advanceAfterIneligible(
    state: LoopTauntState,
    turn: ActiveLoopTauntTurn,
  ): void {
    const next = this.selectNextParticipant(state, turn.exhaustedPlayerNumbers);
    if (next === undefined) {
      this.failLoop(state, "no eligible loop taunt participant");
      return;
    }

    state.currentTurn = {
      attempt: 1,
      epoch: turn.epoch,
      exhaustedPlayerNumbers: turn.exhaustedPlayerNumbers,
      reason: "selected participant ineligible",
      selected: next,
    };
    state.phase = "waiting-report";
    this.sendTurnCommand(state, state.currentTurn);
    this.scheduleReportTimeout(state, state.currentTurn);
  }

  private completeSettleWindow(
    state: LoopTauntState,
    turn: ActiveLoopTauntTurn,
  ): void {
    if (state.currentTurn !== turn) {
      return;
    }

    if (state.focusActive) {
      resetTurn(state);
      return;
    }

    if (turn.attempt === 1) {
      state.phase = "retry-wait";
      this.schedule(state, LOOP_TAUNT_SHORT_RETRY_MS, () =>
        this.retrySelectedParticipant(state, turn),
      );
      return;
    }

    turn.exhaustedPlayerNumbers.add(turn.selected.number);
    const next = this.selectNextParticipant(state, turn.exhaustedPlayerNumbers);
    if (next === undefined) {
      this.failLoop(state, "loop taunt recovery exhausted all participants");
      return;
    }

    state.currentTurn = {
      attempt: 1,
      epoch: turn.epoch,
      exhaustedPlayerNumbers: turn.exhaustedPlayerNumbers,
      reason: "missed cast recovery expired",
      selected: next,
    };
    state.phase = "waiting-report";
    this.sendTurnCommand(state, state.currentTurn);
    this.scheduleReportTimeout(state, state.currentTurn);
  }

  private retrySelectedParticipant(
    state: LoopTauntState,
    turn: ActiveLoopTauntTurn,
  ): void {
    if (state.currentTurn !== turn || state.focusActive) {
      return;
    }

    state.currentTurn = {
      ...turn,
      attempt: 2,
      reason: "missed cast retry",
    };
    state.phase = "waiting-report";
    this.sendTurnCommand(state, state.currentTurn);
    this.scheduleReportTimeout(state, state.currentTurn);
  }

  private scheduleReportTimeout(
    state: LoopTauntState,
    turn: ActiveLoopTauntTurn,
  ): void {
    this.schedule(state, LOOP_TAUNT_TURN_REPORT_TIMEOUT_MS, () => {
      if (state.currentTurn === turn && state.phase === "waiting-report") {
        this.failLoop(state, "loop taunt selected participant did not report");
      }
    });
  }

  private startTurn(state: LoopTauntState, reason: string): void {
    const selected = this.selectNextParticipant(state, new Set());
    if (selected === undefined) {
      this.failLoop(state, "loop taunt has no participants");
      return;
    }

    clearTimers(state);
    state.epoch += 1;
    state.focusActive = false;
    state.currentTurn = {
      attempt: 1,
      epoch: state.epoch,
      exhaustedPlayerNumbers: new Set(),
      reason,
      selected,
    };
    state.phase = "waiting-report";

    const delayMs =
      state.trigger.type === "focus" ? DEFAULT_LOOP_TAUNT_DELAY_MS : 0;
    this.schedule(state, delayMs, () => {
      if (state.currentTurn !== undefined && state.phase === "waiting-report") {
        this.sendTurnCommand(state, state.currentTurn);
        this.scheduleReportTimeout(state, state.currentTurn);
      }
    });
  }

  private selectNextParticipant(
    state: LoopTauntState,
    exhaustedPlayerNumbers: ReadonlySet<number>,
  ): ArmyLoopTauntParticipantPayload | undefined {
    for (let offset = 0; offset < state.participants.length; offset += 1) {
      const index = (state.nextIndex + offset) % state.participants.length;
      const candidate = state.participants[index]!;
      if (!exhaustedPlayerNumbers.has(candidate.number)) {
        state.nextIndex = (index + 1) % state.participants.length;
        return candidate;
      }
    }

    return undefined;
  }
}
