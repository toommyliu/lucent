import { LiveModel } from "./model";

export interface QuestItem {
  readonly itemId: number;
  readonly name: string;
  readonly quantity: number;
}

export interface QuestReward extends QuestItem {
  readonly dropChance?: number;
}

export type QuestCadence = "daily" | "monthly" | "none" | "weekly";

export interface Quest {
  readonly cadence: QuestCadence;
  readonly id: number;
  readonly name: string;
  readonly once: boolean;
  readonly requirements: readonly QuestItem[];
  readonly rewards: readonly QuestReward[];
  toJSON(): QuestSnapshot;
}

export interface QuestData {
  cadence: QuestCadence;
  id: number;
  name: string;
  once: boolean;
  requirements: readonly QuestItem[];
  rewards: readonly QuestReward[];
}

export type QuestSnapshot = Readonly<QuestData>;

export class LiveQuest extends LiveModel<QuestData> implements Quest {
  get cadence(): QuestCadence {
    return this.modelData.cadence;
  }
  get id(): number {
    return this.modelData.id;
  }
  get name(): string {
    return this.modelData.name;
  }
  get once(): boolean {
    return this.modelData.once;
  }
  get requirements(): readonly QuestItem[] {
    return this.modelData.requirements;
  }
  get rewards(): readonly QuestReward[] {
    return this.modelData.rewards;
  }
  toJSON(): QuestSnapshot {
    return {
      ...this.modelData,
      requirements: this.requirements.map((item) => ({ ...item })),
      rewards: this.rewards.map((item) => ({ ...item })),
    };
  }
}
