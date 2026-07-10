import type { Item, ItemSnapshot } from "./item";
import { LiveModel } from "./model";

export interface Shop {
  readonly house: boolean;
  readonly id: number;
  readonly items: readonly Item[];
  readonly limited: boolean;
  readonly merge: boolean;
  readonly name: string;
  toJSON(): ShopSnapshot;
}

export interface ShopData {
  house: boolean;
  id: number;
  items: readonly Item[];
  limited: boolean;
  merge: boolean;
  name: string;
}

export type ShopSnapshot = Readonly<Omit<ShopData, "items">> & {
  readonly items: readonly ItemSnapshot[];
};

export class LiveShop extends LiveModel<ShopData> implements Shop {
  get house(): boolean {
    return this.modelData.house;
  }
  get id(): number {
    return this.modelData.id;
  }
  get items(): readonly Item[] {
    return this.modelData.items;
  }
  get limited(): boolean {
    return this.modelData.limited;
  }
  get merge(): boolean {
    return this.modelData.merge;
  }
  get name(): string {
    return this.modelData.name;
  }
  toJSON(): ShopSnapshot {
    return {
      ...this.modelData,
      items: this.items.map((item) => item.toJSON()),
    };
  }
}
