import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import type { FlashProtocolShape } from "../protocol/FlashProtocol";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { ItemsState } from "../state/Items";
import * as ItemsStore from "../state/Items";
import type { WaitApiShape } from "./Wait";
import { WaitApi } from "./Wait";
import { InventoryApi, layer as InventoryApiLayer } from "./Inventory";

const item = (
  itemId: number,
  name: string,
  overrides: Record<string, unknown> = {},
) => ({
  CharItemID: itemId + 100,
  ItemID: itemId,
  bCoins: false,
  bEquip: false,
  iQty: 1,
  sES: "Weapon",
  sName: name,
  sType: "Weapon",
  ...overrides,
});

const makeLayer = (
  calls: Array<{ readonly args: readonly unknown[]; readonly method: string }>,
) => {
  const bridge = SwfBridge.of({
    call: ((method, args) =>
      Effect.sync(() => {
        calls.push({ args: args ?? [], method });
        if (
          method === "inventory.equip" ||
          method === "inventory.unequipConsumable"
        ) {
          return true;
        }
        return bridgeFallbacks[method]();
      })) as SwfBridgeShape["call"],
    callGameFunction: () => Effect.succeed(null),
    readJson: () => Effect.succeed(null),
  });
  const protocol = FlashProtocol.of({
    emitEvent: () => Effect.void,
    onEvent: () => Effect.succeed(() => {}),
    onPacket: () => Effect.succeed(() => {}),
    onceEvent: () => Effect.succeed(null),
    oncePacket: (selector) =>
      Effect.succeed({
        command: selector?.command ?? "equipItem",
        data: { ItemID: 1, cmd: selector?.command ?? "equipItem" },
        direction: "server",
        raw: "{}",
        wireType: "json",
      }),
    sendClient: () => Effect.void,
    sendServer: () => Effect.void,
  } satisfies FlashProtocolShape);
  const wait = WaitApi.of({
    forEvent: () => Effect.succeed(null),
    forGameAction: () => Effect.succeed(true),
    forPacket: () => Effect.succeed(null),
    isGameActionAvailable: () => Effect.succeed(true),
    until: (condition) => condition,
    untilSome: (condition) =>
      condition.pipe(
        Effect.map((result) => (Option.isSome(result) ? result.value : null)),
      ),
  } satisfies WaitApiShape);

  return InventoryApiLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ItemsStore.layer,
        Layer.succeed(SwfBridge, bridge),
        Layer.succeed(FlashProtocol, protocol),
        Layer.succeed(WaitApi, wait),
      ),
    ),
  );
};

describe("InventoryApi", () => {
  it.effect("fast-fails missing equip before bridge calls", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly args: readonly unknown[];
        readonly method: string;
      }> = [];
      const api = yield* InventoryApi.pipe(Effect.provide(makeLayer(calls)));

      expect(yield* api.equip("Missing Item")).toBe(false);
      expect(calls).toEqual([]);
    }),
  );

  it.effect(
    "returns true for already equipped items without bridge calls",
    () =>
      Effect.gen(function* () {
        const calls: Array<{
          readonly args: readonly unknown[];
          readonly method: string;
        }> = [];
        const layer = makeLayer(calls);
        yield* Effect.gen(function* () {
          const api = yield* InventoryApi;
          const items = yield* ItemsState;
          yield* items.replaceInventory([
            item(1, "Equipped Sword", { bEquip: true }),
          ]);

          expect(yield* api.equip("Equipped Sword")).toBe(true);
          expect(calls).toEqual([]);
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("validates consumable unequip before calling the bridge", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly args: readonly unknown[];
        readonly method: string;
      }> = [];
      const layer = makeLayer(calls);
      yield* Effect.gen(function* () {
        const api = yield* InventoryApi;
        const items = yield* ItemsState;
        yield* items.replaceInventory([
          item(2, "Armor", { bEquip: true, sES: "co", sType: "Armor" }),
          item(3, "Potion", { bEquip: false, sES: "", sType: "Item" }),
        ]);

        expect(yield* api.unequipConsumable("Armor")).toBe(false);
        expect(yield* api.unequipConsumable("Potion")).toBe(true);
        expect(calls).toEqual([]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
