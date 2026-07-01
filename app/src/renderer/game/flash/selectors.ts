import type * as BridgeTypes from "../Types";
import type {
  ItemRecord,
  ItemSelector,
  MonsterRecord,
  MonsterSelector,
  PacketSelector,
  ShopItemRecord,
  ShopItemSelector,
} from "./Types";
import { asPositiveInt, equalsIgnoreCase, includesIgnoreCase } from "./payload";

const integerToken = /^[1-9]\d*$/;

export const normalizeName = (value: string): string =>
  value.trim().toLowerCase();

export const normalizeQuantity = (quantity?: number): number => {
  if (quantity === undefined || !Number.isFinite(quantity)) {
    return 1;
  }

  return Math.max(1, Math.trunc(quantity));
};

export const normalizeItemSelector = (
  selector: ItemSelector,
): BridgeTypes.InventoryItemSelector | null => {
  if (typeof selector === "number") {
    const itemId = asPositiveInt(selector);
    return itemId === undefined ? null : { itemId };
  }

  if (typeof selector === "string") {
    const trimmed = selector.trim();
    if (trimmed === "") {
      return null;
    }

    if (integerToken.test(trimmed)) {
      return { itemId: Number.parseInt(trimmed, 10) };
    }

    return { name: trimmed };
  }

  if ("itemId" in selector) {
    return asPositiveInt(selector.itemId) === undefined
      ? null
      : { itemId: selector.itemId };
  }

  if ("name" in selector) {
    const name = selector.name.trim();
    return name === "" ? null : { name };
  }

  return null;
};

export const normalizeShopItemSelector = (
  selector: ShopItemSelector,
): BridgeTypes.ShopItemSelector | null => {
  const base = normalizeItemSelector(selector as ItemSelector);
  if (base !== null) {
    return base;
  }

  if (
    typeof selector === "object" &&
    selector !== null &&
    "shopItemId" in selector
  ) {
    const shopItemId = asPositiveInt(selector.shopItemId);
    return shopItemId === undefined ? null : { shopItemId };
  }

  return null;
};

export const normalizeMonsterSelector = (
  selector: MonsterSelector,
): BridgeTypes.MonsterSelector | null => {
  if (typeof selector === "number") {
    const monMapId = asPositiveInt(selector);
    return monMapId === undefined ? null : { monMapId };
  }

  if (typeof selector === "string") {
    const trimmed = selector.trim();
    if (trimmed === "") {
      return null;
    }

    const idToken = trimmed.match(/^id[.:'-]?([1-9]\d*)$/i);
    if (idToken?.[1] !== undefined) {
      return { monMapId: Number.parseInt(idToken[1], 10) };
    }

    if (integerToken.test(trimmed)) {
      return { monMapId: Number.parseInt(trimmed, 10) };
    }

    return { name: trimmed };
  }

  if ("monMapId" in selector) {
    const monMapId = asPositiveInt(selector.monMapId);
    return monMapId === undefined ? null : { monMapId };
  }

  if ("name" in selector) {
    const name = selector.name.trim();
    return name === "" ? null : { name };
  }

  return null;
};

export const itemMatchesSelector = (
  item: ItemRecord,
  selector: BridgeTypes.InventoryItemSelector,
): boolean => {
  if ("itemId" in selector) {
    return item.itemId === selector.itemId;
  }

  if ("name" in selector) {
    return equalsIgnoreCase(item.name, selector.name);
  }

  return false;
};

export const shopItemMatchesSelector = (
  item: ShopItemRecord,
  selector: BridgeTypes.ShopItemSelector,
): boolean => {
  if ("shopItemId" in selector) {
    return String(item.shopItemId ?? "") === String(selector.shopItemId);
  }

  return itemMatchesSelector(item, selector);
};

export const monsterMatchesSelector = (
  monster: MonsterRecord,
  selector: BridgeTypes.MonsterSelector,
): boolean => {
  if ("monMapId" in selector) {
    return monster.monsterMapId === selector.monMapId;
  }

  if ("name" in selector) {
    return (
      selector.name === "*" || includesIgnoreCase(monster.name, selector.name)
    );
  }

  return false;
};

export const packetMatchesSelector = (
  packet: {
    readonly command: string;
    readonly direction: string;
    readonly wireType: string;
  },
  selector?: PacketSelector,
): boolean => {
  if (selector === undefined) {
    return true;
  }

  if (
    selector.direction !== undefined &&
    packet.direction !== selector.direction
  ) {
    return false;
  }

  if (
    selector.wireType !== undefined &&
    packet.wireType !== selector.wireType
  ) {
    return false;
  }

  if (selector.command !== undefined && packet.command !== selector.command) {
    return false;
  }

  return true;
};
