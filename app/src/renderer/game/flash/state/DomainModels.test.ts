import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { decodeOutfitModel, decodeShop } from "../payload";
import { ItemsState, layer as ItemsStateLayer } from "./Items";

const rawItem = (banked: boolean, quantity: number) => ({
  CharItemID: 100,
  ItemID: 7,
  bBank: banked,
  bCoins: false,
  iQty: quantity,
  sES: "Weapon",
  sName: "Sword",
  sType: "Weapon",
});

describe("live domain model reconciliation", () => {
  it("decodes outfit loadouts into normalized equipment and colors", () => {
    const outfit = decodeOutfitModel({
      None: 12_917,
      Weapon: 65_845,
      ar: 38_259,
      ba: 57_890,
      co: 58_189,
      colors: {
        accessory: "10027008",
        base: "8556972",
        eye: "91294",
        hair: "6180663",
        skin: "15388042",
        trim: "5398908",
      },
      he: 62_232,
      mi: 73_293,
      name: "speaker",
      pe: 37_262,
    });

    expect(outfit?.name).toBe("speaker");
    expect(outfit?.equipment).toMatchObject({
      armorItemId: 58_189,
      classItemId: 38_259,
      weaponItemId: 65_845,
    });
    expect(outfit?.colors.accessory).toBe(10_027_008);
  });

  it.effect("keeps owned and shop items with the same item id distinct", () =>
    Effect.gen(function* () {
      const items = yield* ItemsState;
      yield* items.replaceInventory([rawItem(false, 1)]);
      const owned = yield* items.get("inventory", 7);
      const shop = decodeShop({
        ShopID: 1,
        items: [{ ...rawItem(false, 1), ShopItemID: "2" }],
        sName: "Weapons",
      });

      expect(shop?.items[0]).not.toBe(owned);
      expect(shop?.items[0]?.context).toBe("shop");
      expect(shop?.items[0]?.shopItemId).toBe(2);
      expect(owned?.context).toBe("inventory");
      expect(decodeShop({})).toBeNull();
    }).pipe(Effect.provide(ItemsStateLayer)),
  );
});
