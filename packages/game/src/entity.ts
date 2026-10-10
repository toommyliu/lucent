import { LiveModel, normalizeGameText } from "./model";
import { LiveAura, reduceActiveAura } from "./aura";
import type {
  Aura,
  AuraDelta,
  AuraKind,
  AuraMutation,
  AuraQueryOptions,
  AuraSnapshot,
} from "./aura";

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
  #acceptsActiveSync = true;

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

  getAura(name: string, options?: AuraQueryOptions): LiveAura | null {
    const normalizedName = normalizeGameText(name);
    for (const aura of this.#auras.values()) {
      if (
        normalizeGameText(aura.name) === normalizedName &&
        (options?.kind === undefined || aura.kind === options.kind)
      ) {
        return aura;
      }
    }
    return null;
  }

  hasAura(name: string, options?: AuraQueryOptions): boolean {
    return this.getAura(name, options) !== null;
  }

  /** @internal */
  projectAuras(mutation: AuraMutation, nowMs: number): readonly AuraDelta[] {
    const changes: AuraDelta[] = [];
    const commit = (
      kind: AuraKind,
      name: string,
      after: AuraSnapshot | undefined,
    ) => {
      const key = `${kind}:${name}`;
      const current = this.#auras.get(key);
      const before = current?.toJSON();
      if (after === undefined) {
        if (before !== undefined) {
          this.#auras.delete(key);
          changes.push({ type: "removed", before });
        }
      } else if (current === undefined || before === undefined) {
        this.#auras.set(key, new LiveAura({ ...after }));
        changes.push({ type: "added", after: { ...after } });
      } else if (
        before.stack !== after.stack ||
        before.duration !== after.duration ||
        before.expiresAt !== after.expiresAt ||
        before.icon !== after.icon ||
        before.category !== after.category ||
        before.value !== after.value ||
        before.persistent !== after.persistent
      ) {
        current.replaceFrom(new LiveAura({ ...after }));
        changes.push({ type: "updated", before, after: { ...after } });
      }
    };
    switch (mutation.type) {
      case "seed": {
        const entries = new Map(
          mutation.entries.map((entry) => [entry.name, entry]),
        );
        for (const aura of this.#auras.values()) {
          if (aura.kind === "active" && !entries.has(aura.name)) {
            commit("active", aura.name, undefined);
          }
        }
        for (const entry of entries.values()) {
          commit(
            "active",
            entry.name,
            reduceActiveAura(
              this.#auras.get(`active:${entry.name}`)?.toJSON(),
              { type: "seed", entry },
              nowMs,
            ),
          );
        }
        break;
      }
      case "apply":
        if (!this.#acceptsActiveSync) break;
        for (const entry of mutation.entries) {
          commit(
            "active",
            entry.name,
            reduceActiveAura(
              this.#auras.get(`active:${entry.name}`)?.toJSON(),
              { type: "apply", entry },
              nowMs,
            ),
          );
        }
        break;
      case "withdraw":
        for (const entry of mutation.entries) {
          if (this.#acceptsActiveSync) {
            commit(
              "active",
              entry.name,
              reduceActiveAura(
                this.#auras.get(`active:${entry.name}`)?.toJSON(),
                entry,
                nowMs,
              ),
            );
          }
          commit("passive", entry.name, undefined);
        }
        break;
      case "set-stack":
        if (!this.#acceptsActiveSync) break;
        for (const entry of mutation.entries) {
          commit(
            "active",
            entry.name,
            reduceActiveAura(
              this.#auras.get(`active:${entry.name}`)?.toJSON(),
              { type: "set-stack", ...entry },
              nowMs,
            ),
          );
        }
        break;
      case "passives": {
        const entries = new Map(
          mutation.entries.map((entry) => [entry.name, entry]),
        );
        if (mutation.mode === "replace") {
          for (const aura of this.#auras.values()) {
            if (aura.kind === "passive" && !entries.has(aura.name)) {
              commit("passive", aura.name, undefined);
            }
          }
        }
        for (const entry of entries.values()) {
          commit("passive", entry.name, {
            ...entry,
            kind: "passive",
            stack: 1,
            persistent: false,
          });
        }
        break;
      }
      case "remove-passives":
        for (const name of mutation.names) commit("passive", name, undefined);
        break;
      case "clear-local":
        for (const aura of this.#auras.values()) {
          if (aura.kind === "active" && !aura.persistent) {
            commit("active", aura.name, undefined);
          }
        }
        break;
    }
    return changes;
  }

  /** @internal */
  writeAuraMonsterState(state: EntityState): readonly AuraDelta[] {
    this.#acceptsActiveSync = state !== EntityState.Dead;
    const changes: AuraDelta[] = [];
    if (state !== EntityState.InCombat) {
      for (const [key, aura] of this.#auras) {
        if (aura.kind === "active") {
          changes.push({ type: "removed", before: aura.toJSON() });
          this.#auras.delete(key);
        }
      }
    }
    return changes;
  }

  isInCell(cell: string): boolean {
    return normalizeGameText(this.cell) === normalizeGameText(cell);
  }

  abstract toJSON(): EntitySnapshot;
}
