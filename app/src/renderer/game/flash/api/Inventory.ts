import { Context, Effect, Layer } from "effect";

import type { ItemRecord, ItemSelector } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { ItemsState } from "../state/Items";
import { WaitApi } from "./Wait";

export interface InventoryApiShape {
  readonly contains: (
    selector: ItemSelector,
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly equip: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly get: (selector: ItemSelector) => Effect.Effect<ItemRecord | null>;
  readonly getAll: () => Effect.Effect<readonly ItemRecord[]>;
  readonly getAvailableSlots: () => Effect.Effect<number>;
  readonly getSlots: () => Effect.Effect<number>;
  readonly getUsedSlots: () => Effect.Effect<number>;
  readonly unequipConsumable: (
    selector: ItemSelector,
  ) => Effect.Effect<boolean>;
}

export class InventoryApi extends Context.Service<
  InventoryApi,
  InventoryApiShape
>()("lucent/game/flash/api/Inventory") {}

export const layer = Layer.effect(
  InventoryApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const items = yield* ItemsState;
    const protocol = yield* FlashProtocol;
    const wait = yield* WaitApi;

    const get: InventoryApiShape["get"] = (selector) =>
      items.get("inventory-or-house", selector);

    const contains: InventoryApiShape["contains"] = (selector, quantity) =>
      items.contains("inventory-or-house", selector, quantity);

    const getSlots = () => bridge.call("inventory.getSlots");
    const getUsedSlots = items.getUsedSlots("inventory");
    const getAvailableSlots = () =>
      Effect.zipWith(getSlots(), getUsedSlots, (slots, used) =>
        Math.max(0, slots - used),
      );

    const equip: InventoryApiShape["equip"] = (selector) =>
      Effect.gen(function* () {
        const item = yield* get(selector);
        if (item === null) {
          return false;
        }

        if (item.equipped) {
          return true;
        }

        const canEquip = yield* wait.forGameAction("equipItem");
        if (!canEquip) {
          return false;
        }

        const sent = yield* bridge.call("inventory.equip", [
          { itemId: item.itemId },
        ]);
        if (!sent) {
          return false;
        }

        const packet = yield* protocol.oncePacket(
          { command: "equipItem" },
          { timeout: "5 seconds" },
        );
        const current = yield* get({ itemId: item.itemId });
        return (
          (packet !== null &&
            JSON.stringify(packet).includes(String(item.itemId))) ||
          current?.equipped === true
        );
      });

    const unequipConsumable: InventoryApiShape["unequipConsumable"] = (
      selector,
    ) =>
      Effect.gen(function* () {
        const item = yield* get(selector);
        if (item === null || item.category !== "Item") {
          return false;
        }

        if (!item.equipped) {
          return true;
        }

        const canUnequip = yield* wait.forGameAction("unequipItem");
        if (!canUnequip) {
          return false;
        }

        const sent = yield* bridge.call("inventory.unequipConsumable", [
          { itemId: item.itemId },
        ]);
        if (!sent) {
          return false;
        }

        yield* protocol.oncePacket(
          { command: "unequipItem" },
          { timeout: "5 seconds" },
        );
        return (yield* get({ itemId: item.itemId }))?.equipped !== true;
      });

    return InventoryApi.of({
      contains,
      equip,
      get,
      getAll: () => items.getAll("inventory"),
      getAvailableSlots,
      getSlots,
      getUsedSlots: () => getUsedSlots,
      unequipConsumable,
    });
  }),
);
