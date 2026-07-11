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

      yield* items.reduceBuyItem(
        { ItemID: 3, bitSuccess: true, iQty: 2 },
        null,
      );
      expect((yield* items.get("inventory", 3))?.quantity).toBe(4);

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
          40: item(40, "Temporary Notification", {
            bTemp: true,
            iQty: 1,
            sES: "",
            sType: "Item",
          }),
        },
      });
      expect((yield* items.getDrops())[0]?.quantity).toBe(5);
      expect(yield* items.getDrops()).toHaveLength(1);

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

  it.effect("adds accepted drop quantities to the projected container", () =>
    Effect.gen(function* () {
      const items = yield* ItemsState.pipe(Effect.provide(ItemsStateLayer));

      yield* items.replaceInventory([
        item(7, "Stacked Tonic", {
          iQty: 3,
          sES: "",
          sType: "Item",
        }),
      ]);
      yield* items.reduceDropItem({
        items: {
          7: item(7, "Stacked Tonic", {
            iQty: 2,
            sES: "",
            sType: "Item",
          }),
        },
      });
      yield* items.reduceGetDrop({
        CharItemID: 1007,
        ItemID: 7,
        bBank: false,
        bSuccess: true,
        iQty: 2,
      });

      expect((yield* items.get("inventory", 7))?.quantity).toBe(5);

      yield* items.replaceBank([
        item(8, "Banked Tonic", {
          bBank: true,
          iQty: 4,
          sES: "",
          sType: "Item",
        }),
      ]);
      yield* items.reduceDropItem({
        items: {
          8: item(8, "Banked Tonic", {
            iQty: 2,
            sES: "",
            sType: "Item",
          }),
        },
      });
      yield* items.reduceGetDrop({
        CharItemID: 1008,
        ItemID: 8,
        bBank: true,
        bSuccess: true,
        iQty: 2,
      });

      expect((yield* items.get("bank", 8))?.quantity).toBe(6);
      expect(yield* items.get("inventory", 8)).toBeNull();
    }),
  );

  it.effect("keeps rejected drops available", () =>
    Effect.gen(function* () {
      const items = yield* ItemsState.pipe(Effect.provide(ItemsStateLayer));

      yield* items.reduceDropItem({
        items: {
          9: item(9, "Rejected Tonic", {
            sES: "",
            sType: "Item",
          }),
        },
      });
      yield* items.reduceGetDrop({
        ItemID: 9,
        bSuccess: false,
        iQty: 1,
      });

      expect(yield* items.getDrops()).toHaveLength(1);
      expect(yield* items.get("inventory", 9)).toBeNull();
    }),
  );

  it.effect(
    "preserves item identity across refreshes and container moves",
    () =>
      Effect.gen(function* () {
        const items = yield* ItemsState.pipe(Effect.provide(ItemsStateLayer));
        yield* items.replaceInventory([item(7, "Sword")]);
        const retained = yield* items.get("inventory", 7);

        yield* items.replaceInventory([item(7, "Sword", { iQty: 2 })]);
        expect(yield* items.get("inventory", 7)).toBe(retained);
        expect(retained?.quantity).toBe(2);

        yield* items.moveInventoryToBank(7);
        expect(yield* items.get("bank", 7)).toBe(retained);
        expect(retained?.context).toBe("bank");
      }),
  );

  it.effect("keeps bank cache isolated from inventory reads", () =>
    Effect.gen(function* () {
      const items = yield* ItemsState.pipe(Effect.provide(ItemsStateLayer));

      yield* items.replaceInventory([item(1, "Inventory Item")]);
      yield* items.replaceBank([item(2, "Bank Item", { bBank: true })]);

      expect(yield* items.get("inventory", "Bank Item")).toBeNull();
      expect((yield* items.get("bank", "Bank Item"))?.banked).toBe(true);
      expect(yield* items.getOwnedQuantity({ itemId: 2 })).toBe(1);
    }),
  );
});
