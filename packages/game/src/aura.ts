import { LiveModel } from "./model";

export type AuraKind = "active" | "passive";

export interface AuraQueryOptions {
  readonly kind?: AuraKind;
}

export interface Aura {
  readonly category: string | undefined;
  readonly duration: number;
  readonly icon: string | undefined;
  readonly kind: AuraKind;
  readonly name: string;
  readonly stack: number;
  readonly value: number | undefined;
  toJSON(): AuraSnapshot;
}

export interface AuraData {
  category?: string;
  duration: number;
  icon?: string;
  kind: AuraKind;
  name: string;
  stack: number;
  value?: number;
}

export type AuraSnapshot = Readonly<AuraData>;

export class LiveAura extends LiveModel<AuraData> implements Aura {
  get category(): string | undefined {
    return this.modelData.category;
  }
  get duration(): number {
    return this.modelData.duration;
  }
  get icon(): string | undefined {
    return this.modelData.icon;
  }
  get kind(): AuraKind {
    return this.modelData.kind;
  }
  get name(): string {
    return this.modelData.name;
  }
  get stack(): number {
    return this.modelData.stack;
  }
  get value(): number | undefined {
    return this.modelData.value;
  }
  toJSON(): AuraSnapshot {
    return { ...this.modelData };
  }
}
