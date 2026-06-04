import { Effect, Layer, Option } from "effect";
import { expect, test } from "vitest";
import { Bridge, type BridgeShape } from "../Services/Bridge";
import {
  Packet,
  type ExtensionPacketHandler,
  type PacketShape,
} from "../Services/Packet";
import { Shops, type ShopsShape } from "../Services/Shops";
import { Wait, type WaitShape } from "../Services/Wait";
import { ShopsLive } from "./Shops";

const wait = {
  until: (condition) => condition,
  untilSome: (condition) => condition,
  isGameActionAvailable: () => Effect.succeed(true),
  forGameAction: () => Effect.succeed(true),
} as WaitShape;

const shopItem = (
  shopItemId: string,
  itemId: number,
  name: string,
): Record<string, unknown> => ({
  ItemID: itemId,
  ShopItemID: shopItemId,
  sName: name,
});

const loadShopPacket = {
  type: "extension",
  raw: "",
  packetType: "json",
  cmd: "loadShop",
  data: {
    shopinfo: {
      ShopID: 1,
      items: [
        shopItem("s1", 100, "Potion"),
        shopItem("s2", 101, "Potion"),
        shopItem("s3", 102, "Tonic"),
      ],
    },
  },
} as const;

const withShops = <A>(
  bridge: BridgeShape,
  body: (
    shops: ShopsShape,
    loadShop: ExtensionPacketHandler,
  ) => Effect.Effect<A, unknown>,
): Promise<A> => {
  let loadShop: ExtensionPacketHandler | undefined;
  const packet = {
    jsonScoped(cmd: string, handler: ExtensionPacketHandler) {
      if (cmd === "loadShop") {
        loadShop = handler;
      }

      return Effect.void;
    },
  } as unknown as PacketShape;

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const shops = yield* Shops;
        if (loadShop === undefined) {
          throw new Error("loadShop handler was not registered");
        }

        return yield* body(shops, loadShop);
      }),
    ).pipe(
      Effect.provide(
        ShopsLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Bridge)(bridge),
              Layer.succeed(Packet)(packet),
              Layer.succeed(Wait)(wait),
            ),
          ),
        ),
      ),
    ),
  );
};

test("shop selectors preserve duplicate-name ambiguity and key items by ShopItemID", async () => {
  const bridge = {
    call() {
      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withShops(bridge, (shops, loadShop) =>
    Effect.gen(function* () {
      yield* loadShop(loadShopPacket);

      return {
        allKeys: Array.from((yield* shops.getItems()).keys()),
        potionKeys: Array.from(
          (yield* shops.getItems({ name: "Potion" })).keys(),
        ),
        ambiguousPotion: yield* shops.getItem({ name: "Potion" }),
        precisePotion: yield* shops.getItem({
          name: "Potion",
          shopItemId: "s2",
        }),
      };
    }),
  );

  expect(result.allKeys).toEqual(["s1", "s2", "s3"]);
  expect(result.potionKeys).toEqual(["s1", "s2"]);
  expect(Option.isNone(result.ambiguousPotion)).toBe(true);
  expect(
    Option.isSome(result.precisePotion)
      ? result.precisePotion.value.data.ShopItemID
      : null,
  ).toBe("s2");
});

test("buy, canBuy, and max quantity resolve through unique ShopItemID", async () => {
  const calls: Array<{ readonly path: string; readonly args?: readonly unknown[] }> =
    [];
  const bridge = {
    call(path, args) {
      calls.push(
        args === undefined ? { path: String(path) } : { path: String(path), args },
      );
      if (path === "shops.buyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(args?.[0] === "s2") as never;
      }

      if (path === "shops.getMaxBuyQuantityByShopItemId") {
        return Effect.succeed(7) as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withShops(bridge, (shops, loadShop) =>
    Effect.gen(function* () {
      yield* loadShop(loadShopPacket);

      return {
        ambiguousBuy: yield* shops.buy({ name: "Potion" }),
        preciseBuy: yield* shops.buy(
          { shopItemId: "s2" },
          { quantity: 3 },
        ),
        canBuy: yield* shops.canBuy({ itemId: 101 }),
        max: yield* shops.getMaxBuyQuantity({ shopItemId: "s2" }),
      };
    }),
  );

  expect(result.ambiguousBuy).toBe(false);
  expect(result.preciseBuy).toBe(true);
  expect(result.canBuy).toBe(true);
  expect(result.max).toBe(7);
  expect(calls).toContainEqual({
    path: "shops.buyByShopItemId",
    args: ["s2", 3],
  });
  expect(calls).toContainEqual({
    path: "shops.canBuyByShopItemId",
    args: ["s2"],
  });
  expect(calls).toContainEqual({
    path: "shops.getMaxBuyQuantityByShopItemId",
    args: ["s2"],
  });
});
