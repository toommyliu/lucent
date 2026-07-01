import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { vi } from "vitest";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import type { FlashProtocolShape } from "../protocol/FlashProtocol";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { ShopsState } from "../state/Shops";
import * as ShopsStore from "../state/Shops";
import { InventoryApi, type InventoryApiShape } from "./Inventory";
import { ShopsApi, layer as ShopsApiLayer } from "./Shops";
import type { WaitApiShape } from "./Wait";
import { WaitApi } from "./Wait";

const shopInfo = {
  ShopID: 1,
  items: [
    {
      ItemID: 10,
      ShopItemID: 100,
      bCoins: false,
      iQty: 1,
      sName: "Potion",
      sType: "Item",
    },
    {
      ItemID: 11,
      ShopItemID: 101,
      bCoins: false,
      iQty: 1,
      sName: "Potion",
      sType: "Item",
    },
  ],
  sName: "Test Shop",
};

const makeLayer = (
  calls: Array<{ readonly args: readonly unknown[]; readonly method: string }>,
) => {
  let bought = false;
  const bridge = SwfBridge.of({
    call: ((method, args) =>
      Effect.sync(() => {
        calls.push({ args: args ?? [], method });
        switch (method) {
          case "shops.buy":
            bought = true;
            return undefined;
          case "shops.canBuyItem":
            return true;
          default:
            return bridgeFallbacks[method]();
        }
      })) as SwfBridgeShape["call"],
    callGameFunction: () => Effect.succeed(null),
    readJson: () => Effect.succeed(null),
  });
  const inventory = InventoryApi.of({
    contains: () => Effect.succeed(bought),
    equip: () => Effect.succeed(false),
    get: () => Effect.succeed(null),
    getAll: Effect.succeed([]),
    getAvailableSlots: Effect.succeed(0),
    getSlots: Effect.succeed(0),
    getUsedSlots: Effect.succeed(0),
    unequipConsumable: () => Effect.succeed(false),
  } satisfies InventoryApiShape);
  const protocol = FlashProtocol.of({
    emitEvent: () => Effect.void,
    onEvent: () => Effect.succeed(() => {}),
    onPacket: () => Effect.succeed(() => {}),
    onceEvent: () => Effect.succeed(null),
    oncePacket: (selector) =>
      Effect.succeed({
        command: selector?.command ?? "buyItem",
        data: { ItemID: 10, bitSuccess: true, cmd: selector?.command },
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

  return ShopsApiLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ShopsStore.layer,
        Layer.succeed(InventoryApi, inventory),
        Layer.succeed(SwfBridge, bridge),
        Layer.succeed(FlashProtocol, protocol),
        Layer.succeed(WaitApi, wait),
      ),
    ),
  );
};

describe("ShopsApi", () => {
  it.effect("returns null for ambiguous selectors and logs a warning", () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const shops = yield* ShopsState.pipe(Effect.provide(ShopsStore.layer));

      yield* shops.setInfo({ shopinfo: shopInfo });

      expect(yield* shops.getOne("Potion")).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        "[flash:shops]",
        "ambiguous shop item selector",
        expect.any(Object),
      );
      warn.mockRestore();
    }),
  );

  it.effect(
    "settles buy through can-buy, buyItem packet, and inventory state",
    () =>
      Effect.gen(function* () {
        const calls: Array<{
          readonly args: readonly unknown[];
          readonly method: string;
        }> = [];
        yield* Effect.gen(function* () {
          const api = yield* ShopsApi;
          const shops = yield* ShopsState;
          yield* shops.setInfo({
            shopinfo: {
              ...shopInfo,
              items: [shopInfo.items[0]],
            },
          });

          expect(yield* api.buy({ shopItemId: 100 }, { quantity: 1 })).toBe(
            true,
          );
        }).pipe(Effect.provide(makeLayer(calls)));

        expect(calls.map((call) => call.method)).toEqual([
          "shops.canBuyItem",
          "shops.buy",
        ]);
      }),
  );
});
