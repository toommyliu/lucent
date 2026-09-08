export interface ShopLocation {
  readonly map: string;
  readonly shop: number;
}

export interface FarmRoute {
  readonly map: string;
  readonly monster: string;
  readonly cell?: string;
  readonly pad?: string;
  readonly memberOnly?: boolean;
}

export interface Material extends ShopLocation {
  readonly item: string | number;
  readonly name: string;
  readonly batchQuantity?: number;
  readonly farm?: FarmRoute;
}

export interface ScrollRecipe {
  readonly questId: number;
  readonly reward: QuestReward;
  readonly ink: QuestItem;
  readonly maxStack: number;
}

export interface Source extends ShopLocation {
  readonly scroll?: ScrollRecipe;
  readonly item: string | number;
  readonly name?: string;
  readonly batchQuantity?: number;
  readonly farm?: boolean;
  readonly monster?: string;
  readonly cell?: string;
  readonly pad?: string;
  readonly memberOnly?: boolean;
}

export type PotionRecipe = {
  readonly purchase: ShopLocation;
  readonly maxStack: number;
} & (
  | { readonly reagents?: undefined }
  | {
      readonly reagents: readonly [string, string];
      readonly rune: "Gebo" | "Jera" | "Fehu";
      readonly trait:
        | "Wis"
        | "End"
        | "Luc"
        | "Int"
        | "APw"
        | "SPw"
        | "Dam"
        | "hOu"
        | "hRe"
        | "mRe"
        | "Cri"
        | "Dex"
        | "Str"
        | "Hea";
    }
);

export interface Session {
  readonly wanted: ReadonlySet<string>;
  readonly potionMethod: "buy" | "craft";
  readonly mode: "buy" | "farm";
  readonly maxGold: number;
  readonly maxCrafts: number;
  spent: number;
  crafts: number;
}

export interface Goal {
  readonly source: Source;
  readonly quantity: number;
}
