export const GameAction = {
  AcceptQuest: "acceptQuest",
  BuyItem: "buyItem",
  EquipItem: "equipItem",
  EquipLoadout: "equipLoadout",
  GetMapItem: "getMapItem",
  LoadEnhancementShop: "loadEnhShop",
  LoadHairShop: "loadHairShop",
  LoadShop: "loadShop",
  Rest: "rest",
  SellItem: "sellItem",
  Transfer: "tfer",
  TryQuestComplete: "tryQuestComplete",
  UnequipItem: "unequipItem",
  WearItem: "wearItem",
  WearLoadout: "wearLoadout",
} as const;

export type GameAction = (typeof GameAction)[keyof typeof GameAction];
