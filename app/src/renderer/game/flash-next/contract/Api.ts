import type { Duration } from "effect";
import type { ItemQuery, MonsterQuery } from "@lucent/game";

export type Skill = number | string;

export interface QuantityOptions {
  readonly quantity?: number;
}

export interface OutfitOptions {
  readonly keepColors?: boolean;
}

export interface HuntOptions {
  readonly findMost?: boolean;
}

export interface SkillUseOptions {
  readonly force?: boolean;
  readonly wait?: boolean;
}

export interface CombatKillOptions {
  readonly maxKills?: number;
  readonly skillDelay?: number;
  readonly skillSet?: readonly Skill[] | string;
  readonly timeout?: Duration.Input;
}

export interface ConnectOutcome {
  readonly message: string;
  readonly retryable: boolean;
  readonly serverName?: string;
  readonly status:
    | "blocked"
    | "connected"
    | "connection-error"
    | "connection-failed"
    | "full"
    | "not-found"
    | "not-ready"
    | "timeout";
}

export type ItemSelector = ItemQuery;
export type MonsterSelector = MonsterQuery;
