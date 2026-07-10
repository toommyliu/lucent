import { LiveModel } from "./model";

export interface Faction {
  readonly id: number;
  readonly name: string;
  readonly rank: number;
  readonly reputation: number;
  toJSON(): FactionSnapshot;
}

export interface FactionData {
  id: number;
  name: string;
  rank: number;
  reputation: number;
}

export type FactionSnapshot = Readonly<FactionData>;

export class LiveFaction extends LiveModel<FactionData> implements Faction {
  get id(): number {
    return this.modelData.id;
  }
  get name(): string {
    return this.modelData.name;
  }
  get rank(): number {
    return this.modelData.rank;
  }
  get reputation(): number {
    return this.modelData.reputation;
  }
  toJSON(): FactionSnapshot {
    return { ...this.modelData };
  }
}
