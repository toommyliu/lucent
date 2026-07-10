import { LiveModel, normalizeGameText } from "./model";

const percent = (value: number, maximum: number): number =>
  maximum <= 0 ? 0 : (value / maximum) * 100;

export const EntityState = {
  Dead: 0,
  Idle: 1,
  InCombat: 2,
} as const;

export type EntityState = (typeof EntityState)[keyof typeof EntityState];

export const isEntityState = (value: unknown): value is EntityState =>
  value === EntityState.Dead ||
  value === EntityState.Idle ||
  value === EntityState.InCombat;

export interface Entity {
  readonly alive: boolean;
  readonly cell: string;
  readonly dead: boolean;
  readonly hp: number;
  readonly hpPercent: number;
  readonly idle: boolean;
  readonly inCombat: boolean;
  readonly maxHp: number;
  readonly maxMp: number;
  readonly mp: number;
  readonly mpPercent: number;
  readonly state: EntityState;
  isInCell(cell: string): boolean;
  toJSON(): EntitySnapshot;
}

export interface EntityData {
  cell: string;
  hp: number;
  maxHp: number;
  maxMp: number;
  mp: number;
  state: EntityState;
}

export type EntitySnapshot = Readonly<EntityData> & {
  readonly alive: boolean;
  readonly dead: boolean;
  readonly hpPercent: number;
  readonly idle: boolean;
  readonly inCombat: boolean;
  readonly mpPercent: number;
};

export abstract class LiveEntity<State extends EntityData>
  extends LiveModel<State>
  implements Entity
{
  get alive(): boolean {
    return this.hp > 0 && this.state !== EntityState.Dead;
  }

  get cell(): string {
    return this.modelData.cell;
  }

  get dead(): boolean {
    return !this.alive;
  }

  get hp(): number {
    return this.modelData.hp;
  }

  get hpPercent(): number {
    return percent(this.hp, this.maxHp);
  }

  get idle(): boolean {
    return this.state === EntityState.Idle;
  }

  get inCombat(): boolean {
    return this.state === EntityState.InCombat;
  }

  get maxHp(): number {
    return this.modelData.maxHp;
  }

  get maxMp(): number {
    return this.modelData.maxMp;
  }

  get mp(): number {
    return this.modelData.mp;
  }

  get mpPercent(): number {
    return percent(this.mp, this.maxMp);
  }

  get state(): EntityState {
    return this.modelData.state;
  }

  isInCell(cell: string): boolean {
    return normalizeGameText(this.cell) === normalizeGameText(cell);
  }

  abstract toJSON(): EntitySnapshot;
}
