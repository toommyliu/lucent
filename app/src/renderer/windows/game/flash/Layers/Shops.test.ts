import { Effect, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import { Bridge, type BridgeShape } from "../Services/Bridge";
import { Inventory, type InventoryShape } from "../Services/Inventory";
import {
  Packet,
  type ExtensionPacketHandler,
  type PacketShape,
} from "../Services/Packet";
import { Shops, type ShopsShape } from "../Services/Shops";
import { Wait, type WaitShape } from "../Services/Wait";
import { ShopsLive } from "./Shops";

type EmitJsonPacket = (
  cmd: string,
  data: Record<string, unknown>,
) => Effect.Effect<void, unknown>;

const emitNoJson: EmitJsonPacket = () => Effect.void;

const wait = {
  until: (condition) => condition,
  untilSome: (condition) => condition,
  isGameActionAvailable: () => Effect.succeed(true),
  forGameAction: () => Effect.succeed(true),
} as WaitShape;

const inventory = {
  contains: () => Effect.succeed(true),
  equip: () => Effect.succeed(true),
  getItem: () => Effect.succeed(null),
  getItems: () => Effect.succeed([]),
  getSlots: () => Effect.succeed(0),
  getUsedSlots: () => Effect.succeed(0),
  getAvailableSlots: () => Effect.succeed(0),
} satisfies InventoryShape;

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

const sampleBuyShopPacket = {
  type: "extension",
  raw: "",
  packetType: "json",
  cmd: "loadShop",
  data: {
    shopinfo: {
      ShopID: 2_290,
      items: [shopItem("47939", 29_648, "Sample Voucher")],
    },
  },
} as const;

const withShops = <A>(
  bridge: BridgeShape,
  body: (
    shops: ShopsShape,
    loadShop: ExtensionPacketHandler,
    emitJson: EmitJsonPacket,
  ) => Effect.Effect<A, unknown>,
  inventoryOverride: InventoryShape = inventory,
  options?: { readonly testClock?: boolean },
): Promise<A> => {
  let loadShop: ExtensionPacketHandler | undefined;
  const jsonHandlers = new Map<string, Set<ExtensionPacketHandler>>();
  const registerJsonHandler = (
    cmd: string,
    handler: ExtensionPacketHandler,
  ): (() => void) => {
    const handlers = jsonHandlers.get(cmd) ?? new Set<ExtensionPacketHandler>();
    handlers.add(handler);
    jsonHandlers.set(cmd, handlers);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        jsonHandlers.delete(cmd);
      }
    };
  };
  const emitJson: EmitJsonPacket = (cmd, data) => {
    const handlers = Array.from(jsonHandlers.get(cmd) ?? []);
    const packet = {
      type: "extension",
      raw: JSON.stringify({ dataObj: data, type: "json" }),
      packetType: "json",
      cmd,
      data,
    } as const;
    return Effect.forEach(handlers, (handler) => handler(packet), {
      discard: true,
    });
  };
  const packet = {
    jsonScoped(cmd: string, handler: ExtensionPacketHandler) {
      if (cmd === "loadShop") {
        loadShop = handler;
      }

      return Effect.void;
    },
    json(cmd: string, handler: ExtensionPacketHandler) {
      return Effect.sync(() => registerJsonHandler(cmd, handler));
    },
  } as unknown as PacketShape;
  const layer = ShopsLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Bridge)(bridge),
        Layer.succeed(Inventory)(inventoryOverride),
        Layer.succeed(Packet)(packet),
        Layer.succeed(Wait)(wait),
      ),
    ),
  );

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const shops = yield* Shops;
        if (loadShop === undefined) {
          throw new Error("loadShop handler was not registered");
        }

        return yield* body(shops, loadShop, emitJson);
      }),
    ).pipe(
      Effect.provide(
        options?.testClock === true
          ? Layer.mergeAll(layer, TestClock.layer())
          : layer,
      ),
    ),
  );
};

test("shop items are keyed by ShopItemID and precise selectors resolve one item", async () => {
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
        precisePotion: yield* shops.getItem({
          name: "Potion",
          shopItemId: "s2",
        }),
      };
    }),
  );

  expect(result.allKeys).toEqual(["s1", "s2", "s3"]);
  expect(
    Option.isSome(result.precisePotion)
      ? result.precisePotion.value.data.ShopItemID
      : null,
  ).toBe("s2");
});

test("ambiguous shop selectors fail with matching item identities", async () => {
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

  await expect(
    withShops(bridge, (shops, loadShop) =>
      Effect.gen(function* () {
        yield* loadShop(loadShopPacket);
        yield* shops.buy({ name: "Potion" });
      }),
    ),
  ).rejects.toMatchObject({
    _tag: "ShopItemSelectorAmbiguousError",
    selector: { name: "Potion" },
    matches: [
      { name: "Potion", itemId: 100, shopItemId: "s1" },
      { name: "Potion", itemId: 101, shopItemId: "s2" },
    ],
  });
});

test("buy, canBuy, and max quantity resolve through unique ShopItemID", async () => {
  const calls: Array<{ readonly path: string; readonly args?: readonly unknown[] }> =
    [];
  let emitJson: EmitJsonPacket = emitNoJson;
  const bridge = {
    call(path, args) {
      calls.push(
        args === undefined ? { path: String(path) } : { path: String(path), args },
      );
      if (path === "shops.buyByShopItemId") {
        return Effect.suspend(() =>
          emitJson("buyItem", {
            bBank: 0,
            bitSuccess: 1,
            CharItemID: 1_234,
            cmd: "buyItem",
            ItemID: 101,
            iQty: 3,
          }),
        ) as never;
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

  const result = await withShops(bridge, (shops, loadShop, emit) =>
    Effect.gen(function* () {
      emitJson = emit;
      yield* loadShop(loadShopPacket);

      return {
        preciseBuy: yield* shops.buy(
          { shopItemId: "s2" },
          { quantity: 3 },
        ),
        canBuy: yield* shops.canBuy({ itemId: 101 }),
        max: yield* shops.getMaxBuyQuantity({ shopItemId: "s2" }),
      };
    }),
  );

  expect(result.preciseBuy).toBe(true);
  expect(result.canBuy).toBe(true);
  expect(result.max).toBe(7);
  expect(calls).toContainEqual({
    path: "shops.buyByShopItemId",
    args: ["s2", 3],
  });
  expect(calls).toContainEqual({
    path: "shops.canBuyByShopItemId",
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

test("buy returns false without sending when item cannot be bought", async () => {
  const calls: Array<{ readonly path: string; readonly args?: readonly unknown[] }> =
    [];
  const bridge = {
    call(path, args) {
      calls.push(
        args === undefined ? { path: String(path) } : { path: String(path), args },
      );
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(false) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.void as never;
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
      return yield* shops.buy({ shopItemId: "s2" }, { quantity: 3 });
    }),
  );

  expect(result).toBe(false);
  expect(calls).toContainEqual({
    path: "shops.canBuyByShopItemId",
    args: ["s2", 3],
  });
  expect(calls).not.toContainEqual({
    path: "shops.buyByShopItemId",
    args: ["s2", 3],
  });
});

test("buy returns false when command sends but no buyItem response arrives", async () => {
  const calls: Array<{ readonly path: string; readonly args?: readonly unknown[] }> =
    [];
  const bridge = {
    call(path, args) {
      calls.push(
        args === undefined ? { path: String(path) } : { path: String(path), args },
      );
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.void as never;
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

  const result = await withShops(
    bridge,
    (shops, loadShop) =>
      Effect.gen(function* () {
        yield* loadShop(loadShopPacket);
        const fiber = yield* Effect.forkDetach(
          shops.buy({ shopItemId: "s2" }, { quantity: 1 }),
          { startImmediately: true },
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust("6 seconds");
        return yield* Fiber.join(fiber);
      }),
    inventory,
    { testClock: true },
  );

  expect(result).toBe(false);
  expect(calls).toContainEqual({
    path: "shops.canBuyByShopItemId",
    args: ["s2", 1],
  });
  expect(calls).toContainEqual({
    path: "shops.buyByShopItemId",
    args: ["s2", 1],
  });
});

test("buy returns true on matching buyItem extension response", async () => {
  let emitJson: EmitJsonPacket = emitNoJson;
  const bridge = {
    call(path) {
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.gen(function* () {
          yield* emitJson("buyItem", {
            bBank: 0,
            bitSuccess: 1,
            CharItemID: 1_234,
            cmd: "buyItem",
            ItemID: 102,
            iQty: 1,
          });
          yield* emitJson("buyItem", {
            bBank: 0,
            bitSuccess: 1,
            CharItemID: 5_678,
            cmd: "buyItem",
            ItemID: 101,
            iQty: 1,
          });
        }) as never;
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

  const result = await withShops(bridge, (shops, loadShop, emit) =>
    Effect.gen(function* () {
      emitJson = emit;
      yield* loadShop(loadShopPacket);
      return yield* shops.buy({ shopItemId: "s2" });
    }),
  );

  expect(result).toBe(true);
});

test("buy returns true for provided buyItem extension response shape", async () => {
  let emitJson: EmitJsonPacket = emitNoJson;
  const bridge = {
    call(path) {
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.suspend(() =>
          emitJson("buyItem", {
            CharItemID: 1_308_828_904,
            ItemID: 29_648,
            cmd: "buyItem",
            bitSuccess: 1,
            bBank: 0,
            iQty: 1,
          }),
        ) as never;
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

  const result = await withShops(bridge, (shops, loadShop, emit) =>
    Effect.gen(function* () {
      emitJson = emit;
      yield* loadShop(sampleBuyShopPacket);
      return yield* shops.buy({ shopItemId: "47939" });
    }),
  );

  expect(result).toBe(true);
});

test("buy ignores non-buy extension packets before confirmation", async () => {
  let emitJson: EmitJsonPacket = emitNoJson;
  const bridge = {
    call(path) {
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.gen(function* () {
          yield* emitJson("balance", {
            cmd: "balance",
            intCoins: 1_396,
            intExp: 0,
            intGold: 97_781_783,
            iUpgDays: -935,
          });
          yield* emitJson("buyItem", {
            bBank: 0,
            bitSuccess: 1,
            CharItemID: 5_678,
            cmd: "buyItem",
            ItemID: 101,
            iQty: 1,
          });
        }) as never;
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

  const result = await withShops(bridge, (shops, loadShop, emit) =>
    Effect.gen(function* () {
      emitJson = emit;
      yield* loadShop(loadShopPacket);
      return yield* shops.buy({ shopItemId: "s2" });
    }),
  );

  expect(result).toBe(true);
});

test("buy returns false on rejected buyItem extension response", async () => {
  let emitJson: EmitJsonPacket = emitNoJson;
  const bridge = {
    call(path) {
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.suspend(() =>
          emitJson("buyItem", {
            bitSuccess: 0,
            cmd: "buyItem",
          }),
        ) as never;
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

  const result = await withShops(bridge, (shops, loadShop, emit) =>
    Effect.gen(function* () {
      emitJson = emit;
      yield* loadShop(loadShopPacket);
      return yield* shops.buy({ shopItemId: "s2" });
    }),
  );

  expect(result).toBe(false);
});

test("buy returns false when buyItem response times out", async () => {
  const bridge = {
    call(path) {
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.void as never;
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

  const result = await withShops(
    bridge,
    (shops, loadShop) =>
      Effect.gen(function* () {
        yield* loadShop(loadShopPacket);
        const fiber = yield* Effect.forkDetach(shops.buy({ shopItemId: "s2" }), {
          startImmediately: true,
        });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("6 seconds");
        return yield* Fiber.join(fiber);
      }),
    inventory,
    { testClock: true },
  );

  expect(result).toBe(false);
});

test("buy success is not converted to false when inventory settlement lags", async () => {
  const containsChecks: Array<{
    readonly item: ItemIdentifierToken;
    readonly quantity?: number;
  }> = [];
  let emitJson: EmitJsonPacket = emitNoJson;
  const bridge = {
    call(path) {
      if (path === "shops.canBuyByShopItemId") {
        return Effect.succeed(true) as never;
      }

      if (path === "shops.buyByShopItemId") {
        return Effect.suspend(() =>
          emitJson("buyItem", {
            bBank: 0,
            bitSuccess: 1,
            CharItemID: 1_234,
            cmd: "buyItem",
            ItemID: 101,
            iQty: 1,
          }),
        ) as never;
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
  const staleInventory = {
    ...inventory,
    getItem: () =>
      Effect.succeed({
        id: 101,
        quantity: 1,
      } as never),
    contains: (item, quantity) =>
      Effect.sync(() => {
        containsChecks.push(
          quantity === undefined ? { item } : { item, quantity },
        );
        return false;
      }),
  } satisfies InventoryShape;

  const result = await withShops(
    bridge,
    (shops, loadShop, emit) =>
      Effect.gen(function* () {
        emitJson = emit;
        yield* loadShop(loadShopPacket);
        return yield* shops.buy({ shopItemId: "s2" }, { quantity: 1 });
      }),
    staleInventory,
  );

  expect(result).toBe(true);
  expect(containsChecks).toEqual([
    { item: 101, quantity: 1 },
    { item: 101, quantity: 1 },
  ]);
});
