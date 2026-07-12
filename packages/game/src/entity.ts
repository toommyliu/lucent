import { LiveModel, normalizeGameText } from "./model";
import { LiveAura } from "./aura";
import type { Aura, AuraKind, AuraQueryOptions, AuraSnapshot } from "./aura";

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
  readonly auras: readonly Aura[];
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
  getAura(name: string, options?: AuraQueryOptions): Aura | null;
  hasAura(name: string, options?: AuraQueryOptions): boolean;
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
  readonly auras: readonly AuraSnapshot[];
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
  readonly #auras = new Map<string, LiveAura>();

  get alive(): boolean {
    return this.hp > 0 && this.state !== EntityState.Dead;
  }

  get auras(): readonly LiveAura[] {
    return Array.from(this.#auras.values());
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

  addAura(aura: LiveAura, operation: "add" | "refresh"): void {
    const key = this.auraKey(aura.name, aura.kind);
    const current = this.#auras.get(key);
    if (current === undefined) {
      this.#auras.set(key, aura);
      return;
    }

    const stack = operation === "add" ? current.stack + 1 : current.stack;
    current.update({ ...aura.toJSON(), stack });
  }

  clearAuras(): void {
    this.#auras.clear();
  }

  getAura(name: string, options?: AuraQueryOptions): LiveAura | null {
    if (options?.kind !== undefined) {
      return this.#auras.get(this.auraKey(name, options.kind)) ?? null;
    }

    const normalizedName = normalizeGameText(name);
    return (
      this.auras.find(
        (aura) => normalizeGameText(aura.name) === normalizedName,
      ) ?? null
    );
  }

  hasAura(name: string, options?: AuraQueryOptions): boolean {
    return this.getAura(name, options) !== null;
  }

  removeAura(name: string, kind?: AuraKind): void {
    const normalizedName = normalizeGameText(name);
    for (const [key, aura] of this.#auras) {
      if (
        normalizeGameText(aura.name) !== normalizedName ||
        (kind !== undefined && aura.kind !== kind)
      ) {
        continue;
      }

      const stack = Math.max(0, aura.stack - 1);
      if (stack === 0) this.#auras.delete(key);
      else aura.update({ stack });
    }
  }

  private auraKey(name: string, kind: AuraKind): string {
    return `${kind}:${normalizeGameText(name)}`;
  }

  isInCell(cell: string): boolean {
    return normalizeGameText(this.cell) === normalizeGameText(cell);
  }

  abstract toJSON(): EntitySnapshot;
}
