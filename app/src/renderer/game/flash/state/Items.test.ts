import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { LiveItem } from "@lucent/game";

import { ItemsState, layer as ItemsStateLayer } from "./Items";

const item = (
  itemId: number,
  name: string,
  overrides: Record<string, unknown> = {},
) => ({
  CharItemID: itemId + 1000,
  ItemID: itemId,
  bCoins: false,
  bEquip: false,
  iQty: 1,
  sES: "Weapon",
  sName: name,
  sType: "Weapon",
  ...overrides,
});

describe("ItemsState reducers", () => {
  it.effect("loads inventory and applies item mutations", () =>
    Effect.gen(function* () {
      const items = yield* ItemsState.pipe(Effect.provide(ItemsStateLayer));

      yield* items.replaceInventory([
        item(1, "Starter Sword", { bEquip: true }),
        item(2, "Health Potion", { iQty: 3, sES: "", sType: "Item" }),
      ]);

      expect((yield* items.get("inventory", "Starter Sword"))?.equipped).toBe(
        true,
      );
      expect(yield* items.contains("inventory", "Health Potion", 3)).toBe(true);

      yield* items.reduceEquip(1, false, "Weapon");
      expect((yield* items.get("inventory", 1))?.equipped).toBe(false);

      yield* items.reduceBuyItem(
        { ItemID: 3, bitSuccess: true, iQty: 2 },
        new LiveItem({
          category: "Item",
          coins: false,
          context: "shop",
          cost: 10,
          description: "",
          equipped: false,
          equipmentSlot: "",
          file: "",
          houseItem: false,
          itemId: 3,
          link: "",
          meta: "",
          name: "Bought Tonic",
          quantity: 1,
          temporaryItem: false,
        }),
      );
      expect((yield* items.get("inventory", 3))?.quantity).toBe(2);

      yield* items.reduceRemoveItem({ CharItemID: 1002, iQty: 1 });
      expect((yield* items.get("inventory", 2))?.quantity).toBe(2);
    }),
  );

  it.effect("tracks drops, accepts drops, and consumes temp turn-ins", () =>
    Effect.gen(function* () {
      const items = yield* ItemsState.pipe(Effect.provide(ItemsStateLayer));

      yield* items.reduceDropItem({
        items: {
          4: item(4, "Dropped Token", { iQty: 5, sES: "", sType: "Item" }),
        },
      });
      expect((yield* items.getDrops())[0]?.quantity).toBe(5);

      yield* items.reduceGetDrop({
        ItemID: 4,
        bSuccess: true,
        iQty: 5,
      });
      expect(yield* items.getDrops()).toHaveLength(0);
      expect((yield* items.get("inventory", 4))?.quantity).toBe(5);

      yield* items.reduceAddItems({
        items: {
          5: item(5, "Temp Gem", {
            bTemp: true,
            iQty: 3,
            sES: "",
            sType: "Item",
          }),
          6: item(6, "Numeric Temp Gem", {
            bTemp: 1,
            iQty: 1,
            sES: "",
            sType: "Item",
          }),
        },
      });
      expect((yield* items.get("temp", 5))?.quantity).toBe(3);
      expect((yield* items.get("temp", 6))?.quantity).toBe(1);

      yield* items.replaceInventory([
        item(88660, "Stacking Drop", {
          CharItemID: 1_345_865_037,
          iQty: 1,
          sES: "",
          sType: "Item",
        }),
      ]);
      yield* items.reduceAddItems({
        items: {
          88660: {
            CharItemID: 1_345_865_037,
            bBank: 0,
            iQty: 1,
            iQtyNow: 2,
          },
        },
      });
      expect((yield* items.get("inventory", 88660))?.quantity).toBe(2);

      yield* items.reduceTurnIn({ sItems: "5:2" });
      expect((yield* items.get("temp", 5))?.quantity).toBe(1);
    }),
  );

  it.effect("keeps bank cache isolated from inventory reads", () =>
    Effect.gen(function* () {
      const items = yield* ItemsState.pipe(Effect.provide(ItemsStateLayer));

      yield* items.replaceInventory([item(1, "Inventory Item")]);
      yield* items.replaceBank([item(2, "Bank Item", { bBank: true })]);

      expect(yield* items.get("inventory", "Bank Item")).toBeNull();
      expect((yield* items.get("bank", "Bank Item"))?.banked).toBe(true);
    }),
  );
});
