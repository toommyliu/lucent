import { ServiceMap } from "effect";
import type { Avatar, Monster } from "@lucent/game";
import type { Collection } from "@lucent/collection";
import type { Aura } from "@lucent/game";
import type { Option } from "effect";
import type { BridgeEffect } from "./Bridge";
import type { ConsumableSkillItem } from "../Types";
import type { WorldEntity } from "./World";

export interface CombatKillOptions {
  readonly killPriority?: readonly MonsterIdentifierToken[] | string;
  readonly skillSet?: readonly Skill[] | string;
  readonly skillDelay?: number;
  readonly skillWait?: boolean;
}

export interface CombatTargetAurasShape {
  getAll(): BridgeEffect<Collection<string, Aura>>;
  get(auraName: string): BridgeEffect<Option.Option<Aura>>;
  has(auraName: string, minStacks?: number): BridgeEffect<boolean>;
}

export interface CombatTargetShape {
  get(): BridgeEffect<Option.Option<WorldEntity>>;
  readonly auras: CombatTargetAurasShape;
}

export interface CombatShape {
  attackMonster(monster: MonsterIdentifierToken): BridgeEffect<boolean>;
  cancelAutoAttack(): BridgeEffect<void>;
  cancelTarget(): BridgeEffect<void>;
  canUseSkill(index: number | string): BridgeEffect<boolean>;
  exit(): BridgeEffect<boolean>;
  getConsumableSkillItem(): BridgeEffect<ConsumableSkillItem | null>;
  getTarget(): BridgeEffect<Monster | Avatar | null>;
  hasTarget(): BridgeEffect<boolean>;
  readonly target: CombatTargetShape;
  kill(
    target: MonsterIdentifierToken,
    options?: CombatKillOptions,
  ): BridgeEffect<void>;
  killForItem(
    target: MonsterIdentifierToken,
    item: ItemIdentifierToken,
    quantity?: number,
    options?: CombatKillOptions,
  ): BridgeEffect<void>;
  killForTempItem(
    target: MonsterIdentifierToken,
    item: ItemIdentifierToken,
    quantity?: number,
    options?: CombatKillOptions,
  ): BridgeEffect<void>;
  useSkill(
    index: number | string,
    force?: boolean,
    wait?: boolean,
  ): BridgeEffect<void>;
  hunt(
    target: MonsterIdentifierToken,
    findMost?: boolean,
  ): BridgeEffect<string>;
}

export class Combat extends ServiceMap.Service<Combat, CombatShape>()(
  "flash/Services/Combat",
) {}
