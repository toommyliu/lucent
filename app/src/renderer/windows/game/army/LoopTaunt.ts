import { parseMonsterMapIdToken } from "@lucent/game";
import type { Aura } from "@lucent/game";
import { equalsIgnoreCase } from "@lucent/shared/string";
import type { Effect } from "effect";
import type {
  WorldMonstersShape,
  WorldPlayersShape,
} from "../flash/Services/World";
import type {
  ArmyLoopTauntTriggerPayload,
  ArmyLoopTauntTriggerReason,
} from "../../../../shared/army";
import type { ArmyEffect } from "./Services/Army";
export {
  DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS,
  DEFAULT_LOOP_TAUNT_DELAY_MS,
  DEFAULT_LOOP_TAUNT_MESSAGE_DEBOUNCE_MS,
  DEFAULT_LOOP_TAUNT_RESPAWN_RECOVERY_MS,
  LOOP_TAUNT_ACTION_LOCK_AURA_CATEGORIES,
  LOOP_TAUNT_FOCUS_AURA_ICON,
  LOOP_TAUNT_FOCUS_AURA_NAME,
  LOOP_TAUNT_RETRY_SETTLE_MS,
  LOOP_TAUNT_SCROLL_SKILL,
  LOOP_TAUNT_SHORT_RETRY_MS,
  LOOP_TAUNT_TURN_REPORT_TIMEOUT_MS,
} from "../../../../shared/loop-taunt";
import {
  LOOP_TAUNT_FOCUS_AURA_ICON,
  LOOP_TAUNT_FOCUS_AURA_NAME,
} from "../../../../shared/loop-taunt";

export type ArmyLoopTauntPlayerRef = number | string;

export type ArmyLoopTauntTrigger = ArmyLoopTauntTriggerPayload;

export type NormalizedLoopTauntTrigger =
  | {
      readonly type: "focus";
    }
  | {
      readonly message: string;
      readonly type: "message";
    };

export interface ResolvedArmyPlayer {
  readonly name: string;
  readonly number: number;
}

export interface ArmyLoopTauntTurnContext {
  readonly id: string;
  readonly target: {
    readonly token: MonsterIdentifierToken;
    readonly monMapId: number;
  };
  readonly localPlayer: ResolvedArmyPlayer;
  readonly participants: readonly ResolvedArmyPlayer[];
  readonly turn: {
    readonly attempt?: number;
    readonly epoch?: number;
  };
  readonly trigger: NormalizedLoopTauntTrigger;
  readonly world: {
    readonly players: Pick<
      WorldPlayersShape,
      "getAll" | "getByName" | "getAuras" | "getAura"
    >;
    readonly monsters: Pick<WorldMonstersShape, "get" | "getAura">;
  };
}

export type ArmyLoopTauntShouldTaunt = (
  context: ArmyLoopTauntTurnContext,
) => boolean | Effect.Effect<boolean, unknown>;

export interface ArmyLoopTauntOptions {
  readonly participants: readonly [
    ArmyLoopTauntPlayerRef,
    ...ArmyLoopTauntPlayerRef[],
  ];
  readonly shouldTaunt?: ArmyLoopTauntShouldTaunt;
  readonly target: MonsterIdentifierToken;
  readonly trigger: ArmyLoopTauntTrigger;
}

export interface ArmyLoopTauntHandle {
  readonly id: string;
  stop(): ArmyEffect<boolean>;
}

export type NormalizedLoopTauntOptions = {
  readonly id: string;
  readonly participants: readonly ResolvedArmyPlayer[];
  readonly shouldTaunt?: ArmyLoopTauntShouldTaunt;
  readonly target: MonsterIdentifierToken;
  readonly trigger: NormalizedLoopTauntTrigger;
};

export interface LoopTauntTurnState {
  readonly exhaustedPlayerNumbers: ReadonlySet<number>;
  readonly nextIndex: number;
  readonly triggerCount: number;
}

export interface LoopTauntTurnResolution {
  readonly nextState: LoopTauntTurnState;
  readonly scheduled: ResolvedArmyPlayer;
  readonly selected: ResolvedArmyPlayer;
  readonly selectedIndex: number;
  readonly skipped: readonly ResolvedArmyPlayer[];
}

export type LoopTauntCastOutcome =
  | {
      readonly type: "cast";
    }
  | {
      readonly reason:
        | "failed"
        | "in-flight"
        | "not-alive"
        | "not-ready"
        | "not-usable";
      readonly type: "skipped";
    };

const normalizeText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const targetLabel = (target: MonsterIdentifierToken): string =>
  typeof target === "number" ? String(target) : target.trim();

const participantLabel = (
  participants: readonly ResolvedArmyPlayer[],
): string =>
  participants
    .map((participant) => `${participant.number}:${participant.name}`)
    .join(",");

const triggerLabel = (trigger: ArmyLoopTauntTrigger): string =>
  trigger.type === "focus"
    ? "focus"
    : `message:${normalizeText(trigger.message)}`;

export const resolveTargetMonMapIdToken = (
  target: MonsterIdentifierToken,
): number | undefined => parseMonsterMapIdToken(target);

export const isTargetNameToken = (target: MonsterIdentifierToken): boolean =>
  typeof target === "string" &&
  resolveTargetMonMapIdToken(target) === undefined;

export const matchesLoopTauntAura = (
  configuredAura: string,
  auraName: string,
): boolean => equalsIgnoreCase(configuredAura, auraName);

export const matchesLoopTauntFocusAura = (auraName: string): boolean =>
  matchesLoopTauntAura(LOOP_TAUNT_FOCUS_AURA_NAME, auraName);

export const matchesLoopTauntFocusAuraAdd = (
  auraName: string,
  aura?: Pick<Aura, "icon">,
): boolean =>
  matchesLoopTauntFocusAura(auraName) &&
  aura?.icon === LOOP_TAUNT_FOCUS_AURA_ICON;

export const matchesLoopTauntAuraAdd = (
  configuredAura: string,
  auraName: string,
  aura?: Pick<Aura, "icon">,
): boolean => {
  if (!matchesLoopTauntAura(configuredAura, auraName)) {
    return false;
  }

  if (!equalsIgnoreCase(configuredAura, LOOP_TAUNT_FOCUS_AURA_NAME)) {
    return true;
  }

  return aura?.icon === LOOP_TAUNT_FOCUS_AURA_ICON;
};

export const matchesLoopTauntMessage = (
  configuredMessage: string,
  message: string,
): boolean => normalizeText(message).includes(normalizeText(configuredMessage));

const assertNonEmptyString = (label: string, value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value.trim();
};

const assertValidTarget = (
  target: MonsterIdentifierToken,
): MonsterIdentifierToken => {
  if (typeof target === "number") {
    if (!Number.isFinite(target) || target <= 0) {
      throw new Error("target must be a positive monster id or non-empty name");
    }

    return Math.trunc(target);
  }

  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("target must be a positive monster id or non-empty name");
  }

  return target.trim();
};

const assertValidTrigger = (trigger: unknown): ArmyLoopTauntTrigger => {
  if (
    typeof trigger !== "object" ||
    trigger === null ||
    Array.isArray(trigger)
  ) {
    throw new Error("Loop Taunt trigger must be an object");
  }

  const record = trigger as Record<string, unknown>;
  if (record["type"] === "focus") {
    return { type: "focus" };
  }

  if (record["type"] === "message") {
    return {
      message: assertNonEmptyString("message", record["message"]),
      type: "message",
    };
  }

  throw new Error('Loop Taunt trigger type must be "focus" or "message"');
};

const assertValidShouldTaunt = (
  shouldTaunt: unknown,
): ArmyLoopTauntShouldTaunt | undefined => {
  if (shouldTaunt === undefined) {
    return undefined;
  }

  if (typeof shouldTaunt !== "function") {
    throw new Error("shouldTaunt must be a function");
  }

  return shouldTaunt as ArmyLoopTauntShouldTaunt;
};

export const createLoopTauntId = (
  target: MonsterIdentifierToken,
  trigger: ArmyLoopTauntTrigger,
  participants: readonly ResolvedArmyPlayer[],
): string =>
  `loop-taunt:${targetLabel(target)}:${triggerLabel(trigger)}:${participantLabel(
    participants,
  )}`;

export const resolveLoopTauntParticipants = (
  sessionPlayers: readonly string[],
  participants: readonly ArmyLoopTauntPlayerRef[],
): readonly ResolvedArmyPlayer[] => {
  if (sessionPlayers.length === 0) {
    throw new Error("army session has no players");
  }

  if (participants.length === 0) {
    throw new Error("participants must contain at least one army player");
  }

  const resolved: ResolvedArmyPlayer[] = [];
  const seen = new Set<string>();

  for (const ref of participants) {
    let player: ResolvedArmyPlayer | undefined;
    if (typeof ref === "number") {
      if (!Number.isInteger(ref) || ref < 1 || ref > sessionPlayers.length) {
        throw new Error(`Unknown army player number: ${String(ref)}`);
      }

      player = {
        name: sessionPlayers[ref - 1]!,
        number: ref,
      };
    } else if (typeof ref === "string" && ref.trim() !== "") {
      const name = ref.trim();
      const index = sessionPlayers.findIndex((sessionPlayer) =>
        equalsIgnoreCase(sessionPlayer, name),
      );
      if (index === -1) {
        throw new Error(`Unknown army player name: ${name}`);
      }

      player = {
        name: sessionPlayers[index]!,
        number: index + 1,
      };
    } else {
      throw new Error("participants must contain army player numbers or names");
    }

    const key = player.name.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate loop taunt participant: ${player.name}`);
    }

    seen.add(key);
    resolved.push(player);
  }

  return resolved;
};

export const normalizeLoopTauntOptions = (
  options: ArmyLoopTauntOptions,
  sessionPlayers: readonly string[],
): NormalizedLoopTauntOptions => {
  const target = assertValidTarget(options.target);
  const trigger = assertValidTrigger(options.trigger);
  const participants = resolveLoopTauntParticipants(
    sessionPlayers,
    options.participants,
  );
  const shouldTaunt = assertValidShouldTaunt(options.shouldTaunt);

  return {
    id: createLoopTauntId(target, trigger, participants),
    participants,
    ...(shouldTaunt === undefined ? {} : { shouldTaunt }),
    target,
    trigger,
  };
};

export const makeLoopTauntTurnState = (): LoopTauntTurnState => ({
  exhaustedPlayerNumbers: new Set(),
  nextIndex: 0,
  triggerCount: 0,
});

export const exhaustLoopTauntParticipant = (
  state: LoopTauntTurnState,
  playerNumber: number,
): LoopTauntTurnState => ({
  ...state,
  exhaustedPlayerNumbers: new Set([
    ...state.exhaustedPlayerNumbers,
    playerNumber,
  ]),
});

export const resolveLoopTauntTurn = (
  participants: readonly ResolvedArmyPlayer[],
  state: LoopTauntTurnState,
): LoopTauntTurnResolution => {
  if (participants.length === 0) {
    throw new Error("Loop Taunt requires at least one participant");
  }

  const startIndex = state.nextIndex % participants.length;
  for (let offset = 0; offset < participants.length; offset += 1) {
    const candidateIndex = (startIndex + offset) % participants.length;
    const candidate = participants[candidateIndex]!;
    if (!state.exhaustedPlayerNumbers.has(candidate.number)) {
      return {
        nextState: {
          exhaustedPlayerNumbers: state.exhaustedPlayerNumbers,
          nextIndex: (candidateIndex + 1) % participants.length,
          triggerCount: state.triggerCount + 1,
        },
        scheduled: candidate,
        selected: candidate,
        selectedIndex: candidateIndex,
        skipped: [],
      };
    }
  }

  throw new Error("Loop Taunt found no eligible participant");
};

export const loopTauntTriggerReasonLabel = (
  reason: ArmyLoopTauntTriggerReason,
): string => {
  switch (reason) {
    case "focus-missing":
      return "focus missing";
    case "focus-removed":
      return "focus removed";
    case "message-matched":
      return "message matched";
  }
};
