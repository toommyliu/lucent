import {
  LiveEntity,
  type Entity,
  type EntityData,
  type EntitySnapshot,
} from "./entity";
import { normalizeGameText } from "./model";

export interface MonsterSelectorByMapId {
  readonly monMapId: number;
  readonly name?: never;
}

export interface MonsterSelectorByName {
  readonly monMapId?: never;
  readonly name: string;
}

export type MonsterSelector = MonsterSelectorByMapId | MonsterSelectorByName;
export type MonsterQuery = MonsterSelector | number | string;

export interface Monster extends Entity {
  readonly level: number;
  readonly monsterId: number;
  readonly monsterMapId: number;
  readonly name: string;
  readonly race: string;
  matches(selector: MonsterQuery): boolean;
}

export interface MonsterData extends EntityData {
  level: number;
  monsterId: number;
  monsterMapId: number;
  name: string;
  race: string;
}

export type MonsterSnapshot = Readonly<MonsterData> & EntitySnapshot;

export class LiveMonster extends LiveEntity<MonsterData> implements Monster {
  get level(): number {
    return this.modelData.level;
  }
  get monsterId(): number {
    return this.modelData.monsterId;
  }
  get monsterMapId(): number {
    return this.modelData.monsterMapId;
  }
  get name(): string {
    return this.modelData.name;
  }
  get race(): string {
    return this.modelData.race;
  }

  matches(selector: MonsterQuery): boolean {
    if (typeof selector === "number") return this.monsterMapId === selector;
    if (typeof selector === "string") {
      const value = selector.trim();
      const match = value.match(/^id[.:'-]?([1-9]\d*)$/i);
      if (match?.[1] !== undefined)
        return this.monsterMapId === Number(match[1]);
      if (/^[1-9]\d*$/.test(value)) return this.monsterMapId === Number(value);
      return (
        value === "*" ||
        normalizeGameText(this.name).includes(normalizeGameText(value))
      );
    }
    return "monMapId" in selector
      ? this.monsterMapId === selector.monMapId
      : selector.name === "*" ||
          normalizeGameText(this.name).includes(
            normalizeGameText(selector.name),
          );
  }

  toJSON(): MonsterSnapshot {
    return {
      ...this.modelData,
      alive: this.alive,
      dead: this.dead,
      hpPercent: this.hpPercent,
      idle: this.idle,
      inCombat: this.inCombat,
      mpPercent: this.mpPercent,
    };
  }
}
