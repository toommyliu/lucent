import { Effect } from "effect";

import type { FlashPacket, FlashProjectionEvent } from "../../Types";
import {
  asBoolean,
  asInt,
  asPositiveInt,
  asRecord,
  asString,
} from "../../payload";
import type { DropsStateShape } from "../../state/Drops";
import type { ItemsStateShape } from "../../state/Items";
import type { ShopsStateShape } from "../../state/Shops";
import type { WorldStateShape } from "../../state/World";
import { packetData } from "../ProjectorDecoders";

const syncDropState = (items: ItemsStateShape, drops: DropsStateShape) =>
  items.getDrops().pipe(Effect.flatMap(drops.replace));

const packetTargetsSelf = (
  payload: Record<string, unknown> | null,
  world: WorldStateShape,
) =>
  Effect.gen(function* () {
    const uid = asPositiveInt(payload?.["uid"]);
    const self = yield* world.getMe();
    return uid !== undefined && self !== null && uid === self.entityId;
  });

export const projectInventoryPacket = (
  packet: FlashPacket,
  items: ItemsStateShape,
  shops: ShopsStateShape,
  drops: DropsStateShape,
  world: WorldStateShape,
): Effect.Effect<readonly FlashProjectionEvent[]> =>
  Effect.gen(function* () {
    const payload = asRecord(packetData(packet));
    switch (packet.command) {
      case "loadInventoryBig": {
        const bankCount = asInt(payload?.["bankCount"]);
        if (bankCount !== undefined) {
          yield* items.setBankCount(bankCount);
        }
        if (Array.isArray(payload?.["items"])) {
          yield* items.replaceInventory(payload["items"]);
        }
        if (Array.isArray(payload?.["hitems"])) {
          yield* items.replaceHouse(payload["hitems"]);
        }
        break;
      }
      case "initInventory":
        if (Array.isArray(payload?.["items"])) {
          yield* items.replaceInventory(payload["items"]);
        }
        break;
      case "loadHouseInventory":
        if (Array.isArray(payload?.["items"])) {
          yield* items.replaceHouse(payload["items"]);
        }
        break;
      case "loadBank":
        if (
          asBoolean(payload?.["bitSuccess"]) === true &&
          Array.isArray(payload?.["items"])
        ) {
          yield* items.replaceBank(payload["items"]);
        }
        break;
      case "bankFromInv": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        if (itemId !== undefined && asBoolean(payload?.["bSuccess"]) === true) {
          yield* items.moveInventoryToBank(itemId);
        }
        break;
      }
      case "bankToInv": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        if (itemId !== undefined) yield* items.moveBankToInventory(itemId);
        break;
      }
      case "bankSwapInv": {
        const inventoryItemId = asPositiveInt(payload?.["invItemID"]);
        const bankItemId = asPositiveInt(payload?.["bankItemID"]);
        if (inventoryItemId !== undefined && bankItemId !== undefined) {
          yield* items.reduceBankSwap(inventoryItemId, bankItemId);
        }
        break;
      }
      case "buyItem": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        const shopItem =
          itemId === undefined ? null : yield* shops.findByItemId(itemId);
        yield* items.reduceBuyItem(payload, shopItem);
        break;
      }
      case "sellItem":
      case "removeItem":
        yield* items.reduceRemoveItem(payload);
        break;
      case "equipItem":
      case "unequipItem": {
        if (!(yield* packetTargetsSelf(payload, world))) break;
        const itemId = asPositiveInt(payload?.["ItemID"]);
        if (itemId !== undefined) {
          yield* items.reduceEquip(
            itemId,
            packet.command === "equipItem",
            asString(payload?.["strES"]),
          );
        }
        break;
      }
      case "enhanceItemShop":
      case "enhanceItemLocal":
        yield* items.reduceEnhancement(payload);
        break;
      case "dropItem":
        yield* items.reduceDropItem(payload);
        yield* syncDropState(items, drops);
        break;
      case "getDrop": {
        if (asBoolean(payload?.["bSuccess"]) === true) {
          yield* items.reduceGetDrop(payload);
          yield* syncDropState(items, drops);
        }
        break;
      }
      case "addItems":
      case "forceAddItem":
        yield* items.reduceAddItems(payload);
        break;
      case "Wheel": {
        yield* items.reduceAddItems({ items: payload?.["dropItems"] });
        const item = asRecord(payload?.["Item"]);
        const itemId = asPositiveInt(item?.["ItemID"]);
        if (item !== null && itemId !== undefined) {
          yield* items.reduceAddItems({ items: { [itemId]: item } });
        }
        break;
      }
      case "turnIn":
      case "removeTempItem":
        yield* items.reduceTurnIn(payload);
        break;
    }

    return [];
  });
