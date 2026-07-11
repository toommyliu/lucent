import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { EntityState, LivePlayer } from "@lucent/game";
import type { FlashPacket } from "../../Types";
import { DropsState, layer as DropsStateLayer } from "../../state/Drops";
import { ItemsState, layer as ItemsStateLayer } from "../../state/Items";
import { ShopsState, layer as ShopsStateLayer } from "../../state/Shops";
import { WorldState, layer as WorldStateLayer } from "../../state/World";
import { projectInventoryPacket } from "./InventoryProjector";

const stateLayer = Layer.mergeAll(
  DropsStateLayer,
  ItemsStateLayer,
  ShopsStateLayer,
  WorldStateLayer,
);

const packet = (
  command: string,
  data: Record<string, unknown> = {},
): FlashPacket => ({
  command,
  data: { cmd: command, ...data },
  direction: "extension",
  raw: "",
  wireType: "json",
});

const item = (
  itemId: number,
  name: string,
  overrides: Record<string, unknown> = {},
) => ({
  CharItemID: itemId + 1000,
  ItemID: itemId,
  bBank: false,
  bCoins: false,
  bEquip: false,
  iQty: 1,
  sES: "Weapon",
  sName: name,
  sType: "Weapon",
  ...overrides,
});

const player = (entityId: number, username: string) =>
  new LivePlayer({
    afk: false,
    cell: "Enter",
    entityId,
    entityType: "player",
    hp: 100,
    level: 1,
    maxHp: 100,
    maxMp: 50,
    mp: 50,
    name: username,
    pad: "Spawn",
    position: { x: 0, y: 0 },
    state: EntityState.Idle,
    username,
  });

describe("Inventory projector", () => {
  it.effect(
    "guards snapshots and equipment by packet outcome and identity",
    () =>
      Effect.gen(function* () {
        const drops = yield* DropsState;
        const items = yield* ItemsState;
        const shops = yield* ShopsState;
        const world = yield* WorldState;
        yield* world.addPlayer(player(1, "Hero"));
        yield* world.setSelf("Hero");

        yield* projectInventoryPacket(
          packet("initInventory", { items: [item(7, "Sword")] }),
          items,
          shops,
          drops,
          world,
        );
        const sword = yield* items.get("inventory", 7);
        expect(sword).not.toBeNull();

        yield* projectInventoryPacket(
          packet("initInventory"),
          items,
          shops,
          drops,
          world,
        );
        expect(yield* items.get("inventory", 7)).toBe(sword);

        yield* projectInventoryPacket(
          packet("equipItem", { ItemID: 7, strES: "Weapon", uid: 2 }),
          items,
          shops,
          drops,
          world,
        );
        expect(sword?.equipped).toBe(false);
        yield* projectInventoryPacket(
          packet("equipItem", { ItemID: 7, strES: "Weapon", uid: 1 }),
          items,
          shops,
          drops,
          world,
        );
        expect(sword?.equipped).toBe(true);

        yield* projectInventoryPacket(
          packet("loadBank", { items: [item(8, "Bank Sword")] }),
          items,
          shops,
          drops,
          world,
        );
        expect(yield* items.get("bank", 8)).toBeNull();
        yield* projectInventoryPacket(
          packet("loadBank", {
            bitSuccess: true,
            items: [item(8, "Bank Sword")],
          }),
          items,
          shops,
          drops,
          world,
        );
        expect((yield* items.get("bank", 8))?.name).toBe("Bank Sword");

        yield* projectInventoryPacket(
          packet("bankFromInv", { ItemID: 7 }),
          items,
          shops,
          drops,
          world,
        );
        expect(yield* items.get("inventory", 7)).toBe(sword);
        yield* projectInventoryPacket(
          packet("bankFromInv", { ItemID: 7, bSuccess: true }),
          items,
          shops,
          drops,
          world,
        );
        expect(yield* items.get("bank", 7)).toBe(sword);
      }).pipe(Effect.provide(stateLayer)),
  );

  it.effect("keeps a drop visible until acceptance succeeds", () =>
    Effect.gen(function* () {
      const drops = yield* DropsState;
      const items = yield* ItemsState;
      const shops = yield* ShopsState;
      const world = yield* WorldState;

      yield* projectInventoryPacket(
        packet("dropItem", {
          items: {
            4: item(4, "Dropped Token", {
              iQty: 5,
              sES: "",
              sType: "Item",
            }),
            5: item(5, "Temporary Token", {
              bTemp: true,
              iQty: 2,
              sES: "",
              sType: "Item",
            }),
          },
        }),
        items,
        shops,
        drops,
        world,
      );
      expect((yield* drops.get(4))?.quantity).toBe(5);
      expect(yield* drops.contains(5)).toBe(false);

      yield* projectInventoryPacket(
        packet("addItems", {
          items: {
            5: item(5, "Temporary Token", {
              bTemp: true,
              iQty: 2,
              sES: "",
              sType: "Item",
            }),
          },
        }),
        items,
        shops,
        drops,
        world,
      );
      expect((yield* items.get("temp", 5))?.quantity).toBe(2);

      yield* projectInventoryPacket(
        packet("getDrop", { ItemID: 4, bSuccess: false, iQty: 5 }),
        items,
        shops,
        drops,
        world,
      );
      expect(yield* drops.contains(4)).toBe(true);
      expect(yield* items.get("inventory", 4)).toBeNull();

      yield* projectInventoryPacket(
        packet("getDrop", { ItemID: 4, bSuccess: true, iQty: 5 }),
        items,
        shops,
        drops,
        world,
      );
      expect(yield* drops.contains(4)).toBe(false);
      expect((yield* items.get("inventory", 4))?.quantity).toBe(5);
    }).pipe(Effect.provide(stateLayer)),
  );
});
