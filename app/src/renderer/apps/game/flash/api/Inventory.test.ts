import { describe, expect, it } from "@effect/vitest";
import { LiveItem } from "@lucent/game";
import { Effect, Option } from "effect";

import type { EquipEnhancementSelector } from "../../EnhancementSelectors";
import type { BridgeService } from "../bridge/Bridge";
import type { Packet } from "../contract/Packet";
import { makeStore } from "../state/Store";
import { makeInventory } from "./Inventory";
import type { Wait } from "./Wait";

const item = ({
  enhancementLevel,
  enhancementPatternId,
  enhancementProcId,
  equipmentSlot,
  equipped = false,
  itemId,
}: {
  readonly enhancementLevel: number;
  readonly enhancementPatternId: number;
  readonly enhancementProcId?: number;
  readonly equipmentSlot: string;
  readonly equipped?: boolean;
  readonly itemId: number;
}) =>
  new LiveItem({
    category: equipmentSlot === "ar" ? "Class" : "Equipment",
    coins: false,
    context: "inventory",
    cost: 0,
    description: "",
    enhancement: {
      level: enhancementLevel,
      patternId: enhancementPatternId,
      ...(enhancementProcId === undefined ? {} : { procId: enhancementProcId }),
    },
    equipped,
    equipmentSlot,
    file: "",
    houseItem: false,
    itemId,
    link: "",
    memberOnly: false,
    meta: "",
    name: `Item ${itemId}`,
    quantity: 1,
    temporaryItem: false,
  });

const makeHarness = (items: readonly LiveItem[]) =>
  Effect.gen(function* () {
    const store = yield* makeStore;
    yield* store.items.replace("inventory", items);

    const equippedItemIds: number[] = [];
    const bridge = {
      invoke: (method: string, args: readonly unknown[] | undefined) =>
        Effect.sync(() => {
          if (method === "inventory.equip") {
            const selector = args?.[0] as { readonly itemId: number };
            equippedItemIds.push(selector.itemId);
            return Option.some(true);
          }
          if (method === "player.getUserId") return Option.some(1);
          if (method === "player.isMember") return Option.some(true);
          return Option.none();
        }),
    } as unknown as BridgeService;
    const wait = {
      forGameAction: () => Effect.succeed(true),
      forPacket: (
        _selector: unknown,
        options: { readonly trigger: Effect.Effect<boolean> },
      ) =>
        Effect.gen(function* () {
          return (yield* options.trigger) ? ({} as Packet) : null;
        }),
    } as unknown as Wait;

    return {
      equippedItemIds,
      inventory: makeInventory(bridge, store, wait),
    };
  });

describe("Inventory.equipByEnhancement", () => {
  it.effect(
    "supports the enhancement selector forms accepted by enhanceItem",
    () =>
      Effect.gen(function* () {
        const best = item({
          enhancementLevel: 30,
          enhancementPatternId: 2,
          enhancementProcId: 14,
          equipmentSlot: "Weapon",
          itemId: 2,
        });
        const { equippedItemIds, inventory } = yield* makeHarness([
          item({
            enhancementLevel: 26,
            enhancementPatternId: 2,
            enhancementProcId: 14,
            equipmentSlot: "Weapon",
            itemId: 1,
          }),
          best,
          item({
            enhancementLevel: 35,
            enhancementPatternId: 10,
            enhancementProcId: 14,
            equipmentSlot: "Weapon",
            itemId: 3,
          }),
        ]);
        const selectors: readonly EquipEnhancementSelector[] = [
          { enhancement: "dauntless" },
          { enhancement: "forge", special: "dauntless" },
          { enhancement: "fighter", special: "dauntless" },
        ];

        for (const selector of selectors) {
          expect(yield* inventory.equipByEnhancement(selector)).toBe(true);
        }
        expect(equippedItemIds).toEqual([
          best.itemId,
          best.itemId,
          best.itemId,
        ]);
      }),
  );

  it.effect("filters by slot and ranks by enhancement level", () =>
    Effect.gen(function* () {
      const { equippedItemIds, inventory } = yield* makeHarness([
        item({
          enhancementLevel: 30,
          enhancementPatternId: 10,
          equipmentSlot: "he",
          itemId: 10,
        }),
        item({
          enhancementLevel: 40,
          enhancementPatternId: 10,
          equipmentSlot: "ba",
          itemId: 11,
        }),
        item({
          enhancementLevel: 35,
          enhancementPatternId: 10,
          equipmentSlot: "he",
          itemId: 12,
        }),
      ]);

      expect(
        yield* (
          inventory.equipByEnhancement as (
            selector: unknown,
          ) => Effect.Effect<boolean>
        )({
          enhancement: " forge ",
          slot: " HELM ",
        }),
      ).toBe(true);
      expect(equippedItemIds).toEqual([12]);
    }),
  );

  it.effect("rejects ambiguous or malformed selectors", () =>
    Effect.gen(function* () {
      const { equippedItemIds, inventory } = yield* makeHarness([
        item({
          enhancementLevel: 30,
          enhancementPatternId: 10,
          equipmentSlot: "he",
          itemId: 10,
        }),
      ]);
      const equipByEnhancement = inventory.equipByEnhancement as (
        selector: unknown,
      ) => Effect.Effect<boolean>;

      expect(yield* equipByEnhancement({ enhancement: "forge" })).toBe(false);
      expect(
        yield* equipByEnhancement({ enhancement: " ", slot: "helm" }),
      ).toBe(false);
      expect(
        yield* equipByEnhancement({
          enhancement: "forge",
          slot: "armor",
        }),
      ).toBe(false);
      expect(equippedItemIds).toEqual([]);
    }),
  );
});
