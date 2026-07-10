import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { EntityState, LiveMonster } from "@lucent/game";

import { decodeOutfitModel, decodeShop } from "../payload";
import { ItemsState, layer as ItemsStateLayer } from "./Items";
import { WorldState, layer as WorldStateLayer } from "./World";

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

  it.effect(
    "preserves owned-item identity across refreshes and container moves",
    () =>
      Effect.gen(function* () {
        const items = yield* ItemsState;
        yield* items.replaceInventory([rawItem(false, 1)]);
        const retained = yield* items.get("inventory", 7);
        expect(retained).not.toBeNull();

        yield* items.replaceInventory([rawItem(false, 2)]);
        expect(yield* items.get("inventory", 7)).toBe(retained);
        expect(retained?.quantity).toBe(2);

        yield* items.moveInventoryToBank(7);
        expect(yield* items.get("bank", 7)).toBe(retained);
        expect(retained?.context).toBe("bank");
      }).pipe(Effect.provide(ItemsStateLayer)),
  );

  it.effect("updates retained monsters and freezes them after removal", () =>
    Effect.gen(function* () {
      const world = yield* WorldState;
      const monster = new LiveMonster({
        cell: "r1",
        hp: 100,
        level: 1,
        maxHp: 100,
        maxMp: 0,
        monsterId: 5,
        monsterMapId: 6,
        mp: 0,
        name: "Slime",
        race: "None",
        state: EntityState.Idle,
      });
      yield* world.addMonster(monster);
      yield* world.patchMonster(6, { hp: 25 });
      expect((yield* world.getMonster(6))?.hp).toBe(25);
      expect(yield* world.getMonster(6)).toBe(monster);

      yield* world.removeMonster(6);
      expect(yield* world.getMonster(6)).toBeNull();
      expect(monster.hp).toBe(25);
    }).pipe(Effect.provide(WorldStateLayer)),
  );
});
