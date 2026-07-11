import { LiveModel, normalizeGameText } from "./model";

export type ItemContext =
  | "bank"
  | "drop"
  | "house"
  | "inventory"
  | "shop"
  | "temporary";

export interface Enhancement {
  readonly dps?: number;
  readonly id?: number;
  readonly level?: number;
  readonly patternId?: number;
  readonly range?: number;
  readonly rarity?: number;
}

export interface ItemSelectorById {
  readonly itemId: number;
  readonly name?: never;
}

export interface ItemSelectorByName {
  readonly itemId?: never;
  readonly name: string;
}

export type ItemSelector = ItemSelectorById | ItemSelectorByName;

export interface ShopItemSelectorById {
  readonly itemId?: never;
  readonly name?: never;
  readonly shopItemId: number;
}

export type ShopItemSelector = ItemSelector | ShopItemSelectorById;
export type ItemQuery = ItemSelector | number | string;
export type ShopItemQuery = ShopItemSelector | number | string;

export const toItemSelector = (query: ItemQuery): ItemSelector => {
  if (typeof query === "number") return { itemId: query };
  if (typeof query === "string") return { name: query.trim() };
  return "name" in query ? { name: query.name.trim() } : query;
};

export const normalizeItemQuantity = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value)
    ? 1
    : Math.max(1, Math.trunc(value));

export interface Item {
  readonly armor: boolean;
  readonly banked: boolean;
  readonly cape: boolean;
  readonly category: string;
  readonly charItemId: number | undefined;
  readonly classItem: boolean;
  readonly coins: boolean;
  readonly context: ItemContext;
  readonly cost: number;
  readonly description: string;
  readonly enhancement: Enhancement | undefined;
  readonly equipped: boolean;
  readonly equipmentSlot: string;
  readonly file: string;
  readonly helm: boolean;
  readonly houseItem: boolean;
  readonly itemId: number;
  readonly link: string;
  readonly meta: string;
  readonly name: string;
  readonly pet: boolean;
  readonly quantity: number;
  readonly shopItemId: number | undefined;
  readonly temporaryItem: boolean;
  readonly weapon: boolean;
  matches(selector: ItemQuery | ShopItemQuery): boolean;
  toJSON(): ItemSnapshot;
}

export interface ItemData {
  category: string;
  charItemId?: number;
  coins: boolean;
  context: ItemContext;
  cost: number;
  description: string;
  enhancement?: Enhancement;
  equipped: boolean;
  equipmentSlot: string;
  file: string;
  houseItem: boolean;
  itemId: number;
  link: string;
  meta: string;
  name: string;
  quantity: number;
  shopItemId?: number;
  temporaryItem: boolean;
}

export type ItemSnapshot = Readonly<ItemData> & {
  readonly armor: boolean;
  readonly banked: boolean;
  readonly cape: boolean;
  readonly classItem: boolean;
  readonly helm: boolean;
  readonly pet: boolean;
  readonly weapon: boolean;
};

export class LiveItem extends LiveModel<ItemData> implements Item {
  get armor(): boolean {
    return this.equipmentSlot === "co";
  }
  get banked(): boolean {
    return this.context === "bank";
  }
  get cape(): boolean {
    return this.equipmentSlot === "ba";
  }
  get category(): string {
    return this.modelData.category;
  }
  get charItemId(): number | undefined {
    return this.modelData.charItemId;
  }
  get classItem(): boolean {
    return this.category === "Class";
  }
  get coins(): boolean {
    return this.modelData.coins;
  }
  get context(): ItemContext {
    return this.modelData.context;
  }
  get cost(): number {
    return this.modelData.cost;
  }
  get description(): string {
    return this.modelData.description;
  }
  get enhancement(): Enhancement | undefined {
    return this.modelData.enhancement;
  }
  get equipped(): boolean {
    return this.modelData.equipped;
  }
  get equipmentSlot(): string {
    return this.modelData.equipmentSlot;
  }
  get file(): string {
    return this.modelData.file;
  }
  get helm(): boolean {
    return this.equipmentSlot === "he";
  }
  get houseItem(): boolean {
    return this.modelData.houseItem;
  }
  get itemId(): number {
    return this.modelData.itemId;
  }
  get link(): string {
    return this.modelData.link;
  }
  get meta(): string {
    return this.modelData.meta;
  }
  get name(): string {
    return this.modelData.name;
  }
  get pet(): boolean {
    return this.equipmentSlot === "pe";
  }
  get quantity(): number {
    return this.modelData.quantity;
  }
  get shopItemId(): number | undefined {
    return this.modelData.shopItemId;
  }
  get temporaryItem(): boolean {
    return this.modelData.temporaryItem;
  }
  get weapon(): boolean {
    return this.equipmentSlot === "Weapon";
  }

  matches(selector: ItemQuery | ShopItemQuery): boolean {
    if (typeof selector === "number") return this.itemId === selector;
    if (typeof selector === "string") {
      return normalizeGameText(this.name) === normalizeGameText(selector);
    }
    if ("itemId" in selector) return this.itemId === selector.itemId;
    if ("name" in selector)
      return normalizeGameText(this.name) === normalizeGameText(selector.name);
    if ("shopItemId" in selector)
      return this.shopItemId === selector.shopItemId;
    return false;
  }

  toJSON(): ItemSnapshot {
    return {
      ...this.modelData,
      armor: this.armor,
      banked: this.banked,
      cape: this.cape,
      classItem: this.classItem,
      ...(this.enhancement === undefined
        ? {}
        : { enhancement: { ...this.enhancement } }),
      helm: this.helm,
      pet: this.pet,
      weapon: this.weapon,
    };
  }
}
