import { LiveModel } from "./model";

export interface OutfitColors {
  readonly accessory: number | undefined;
  readonly base: number | undefined;
  readonly eye: number | undefined;
  readonly hair: number | undefined;
  readonly skin: number | undefined;
  readonly trim: number | undefined;
}

export interface OutfitEquipment {
  readonly armorItemId: number | undefined;
  readonly capeItemId: number | undefined;
  readonly classItemId: number | undefined;
  readonly helmItemId: number | undefined;
  readonly itemId: number | undefined;
  readonly miscItemId: number | undefined;
  readonly petItemId: number | undefined;
  readonly weaponItemId: number | undefined;
}

export interface Outfit {
  readonly colors: OutfitColors;
  readonly equipment: OutfitEquipment;
  readonly name: string;
  toJSON(): OutfitSnapshot;
}

export interface OutfitData {
  colors: OutfitColors;
  equipment: OutfitEquipment;
  name: string;
}

export type OutfitSnapshot = Readonly<OutfitData>;

export class LiveOutfit extends LiveModel<OutfitData> implements Outfit {
  get colors(): OutfitColors {
    return this.modelData.colors;
  }
  get equipment(): OutfitEquipment {
    return this.modelData.equipment;
  }
  get name(): string {
    return this.modelData.name;
  }
  toJSON(): OutfitSnapshot {
    return {
      ...this.modelData,
      colors: { ...this.colors },
      equipment: { ...this.equipment },
    };
  }
}
