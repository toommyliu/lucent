import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { BankView } from "../../Types";
import { Bridge, makeBridge } from "../bridge/Bridge";
import { Gateway, makeGateway } from "../bridge/Gateway";
import { makeApi } from "./Api";

const emitExtension = (target: Window, dataObj: object): void => {
  target.onExtensionResponse?.(JSON.stringify({ dataObj, type: "json" }));
};

const makeTarget = () => {
  const calls = {
    actions: [] as string[],
    bankOpens: 0,
    bankOpenViews: [] as BankView[],
    bankLoadForces: [] as boolean[],
    deposits: 0,
    equips: 0,
    hairShopLoads: 0,
    shopLoads: 0,
    swaps: 0,
    wears: 0,
    withdrawals: 0,
    withdrawalViews: [] as (BankView | null)[],
  };
  let failBankLoad = false;
  let bankLoaded = false;
  let bankView: BankView | null = null;
  let bankItems: readonly unknown[] = [];
  let cachedShopId = 0;
  let openShopId = 0;
  const target = {} as Window;

  target.swf = {
    "auth.isLoggedIn": () => true,
    "bank.deposit": () => {
      calls.deposits += 1;
      emitExtension(target, {
        ItemID: 51,
        bSuccess: 1,
        cmd: "bankFromInv",
      });
      return true;
    },
    "bank.getSlots": () => 2,
    "bank.getItems": () => bankItems,
    "bank.isLoaded": () => bankLoaded,
    "bank.loadItems": (force = false) => {
      calls.bankLoadForces.push(force);
      if (failBankLoad) throw new Error("load failed");
      bankItems = [
        {
          ItemID: "42",
          bCoins: 1,
          iQty: "2",
          sName: "Indexed Item",
        },
        {
          ItemID: "43",
          bHouse: 1,
          sName: "Banked House Item",
        },
        { ItemID: "44", sName: "Occupied Slot" },
      ];
      bankLoaded = true;
    },
    "bank.isOpen": (view?: BankView) =>
      view === undefined ? bankView !== null : bankView === view,
    "bank.open": (view: BankView = "regular") => {
      calls.bankOpens += 1;
      calls.bankOpenViews.push(view);
      bankView = view;
    },
    "bank.swap": () => {
      calls.swaps += 1;
      emitExtension(target, {
        bankItemID: 42,
        cmd: "bankSwapInv",
        invItemID: 50,
      });
      return true;
    },
    "bank.withdraw": () => {
      calls.withdrawals += 1;
      calls.withdrawalViews.push(bankView);
      return false;
    },
    "house.getSlots": () => 1,
    "inventory.equip": (selector: { itemId: number }) => {
      calls.equips += 1;
      emitExtension(target, {
        ItemID: selector.itemId,
        cmd: "equipItem",
        strES: "Weapon",
        uid: 1,
      });
      return true;
    },
    "inventory.wear": (selector: { itemId: number }) => {
      calls.wears += 1;
      emitExtension(target, {
        ItemID: selector.itemId,
        cmd: "wearItem",
        sES: "Weapon",
        success: 1,
        uid: 2,
      });
      emitExtension(target, {
        ItemID: selector.itemId,
        cmd: "wearItem",
        sES: "Weapon",
        success: 1,
        uid: 1,
      });
      return true;
    },
    "inventory.getSlots": () => 4,
    "player.getUserId": () => 1,
    "player.isMember": () => false,
    "shops.isOpen": (shopId = 0) =>
      openShopId !== 0 && (shopId === 0 || shopId === openShopId),
    "shops.load": (shopId: number) => {
      calls.shopLoads += 1;
      openShopId = shopId;
      if (cachedShopId === shopId) return;
      cachedShopId = shopId;
      emitExtension(target, {
        ShopID: shopId,
        cmd: "loadShop",
        items: [],
        sName: "Action-locked Shop",
      });
    },
    "shops.loadHairShop": () => {
      calls.hairShopLoads += 1;
    },
    "world.isActionAvailable": (action: string) => {
      calls.actions.push(action);
      return true;
    },
  } as unknown as Window["swf"];

  return {
    calls,
    closeBankUi: () => {
      bankView = null;
    },
    closeShopUi: () => {
      openShopId = 0;
    },
    failNextBankLoad: () => {
      failBankLoad = true;
    },
    resetBankSession: () => {
      bankItems = [];
      bankLoaded = false;
      bankView = null;
      failBankLoad = false;
    },
    target,
  };
};

describe("Api", () => {
  it.effect("opens the requested bank view for house withdrawals", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { calls, target } = makeTarget();
        const bridge = yield* makeBridge(target);
        const gateway = yield* makeGateway(target).pipe(
          Effect.provideService(Bridge, bridge),
        );
        const api = yield* makeApi.pipe(
          Effect.provideService(Bridge, bridge),
          Effect.provideService(Gateway, gateway),
        );

        expect(yield* api.bank.isOpen()).toBe(false);
        expect(yield* api.bank.open({ view: "house" })).toBe(true);
        expect(yield* api.bank.isOpen()).toBe(true);
        expect(yield* api.bank.isOpen("house")).toBe(true);
        expect(yield* api.bank.isOpen("regular")).toBe(false);
        expect(calls.bankOpenViews).toEqual(["house"]);

        expect(yield* api.bank.open({ view: "house" })).toBe(true);
        expect(calls.bankOpenViews).toEqual(["house"]);

        expect(yield* api.bank.open({ force: true })).toBe(true);
        expect(calls.bankLoadForces).toEqual([true, true]);
        expect(calls.bankOpenViews).toEqual(["house", "regular"]);

        expect(yield* api.bank.withdraw(43)).toBe(false);
        expect(calls.withdrawalViews).toEqual(["house"]);
        expect(calls.bankOpenViews).toEqual(["house", "regular", "house"]);
        expect((yield* api.bank.get(43))?.context).toBe("bank");
        expect(yield* api.house.get(43)).toBeNull();
      }),
    ),
  );

  it.effect("protects container commands and action-locked workflows", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const {
          calls,
          closeBankUi,
          closeShopUi,
          failNextBankLoad,
          resetBankSession,
          target,
        } = makeTarget();
        const bridge = yield* makeBridge(target);
        const gateway = yield* makeGateway(target).pipe(
          Effect.provideService(Bridge, bridge),
        );
        const api = yield* makeApi.pipe(
          Effect.provideService(Bridge, bridge),
          Effect.provideService(Gateway, gateway),
        );

        expect(Object.keys(api).toSorted()).toEqual([
          "auth",
          "bank",
          "combat",
          "drops",
          "events",
          "house",
          "inventory",
          "map",
          "monsters",
          "packet",
          "player",
          "players",
          "quests",
          "settings",
          "shops",
          "tempInventory",
          "wait",
        ]);
        expect(api.bank).not.toBe(api.inventory);
        expect(yield* api.bank.getAll()).toEqual([]);
        expect(yield* api.bank.open()).toBe(true);
        expect(calls.bankLoadForces).toEqual([true]);
        expect((yield* api.bank.getAll())[0]?.quantity).toBe(2);
        expect(calls.bankOpens).toBe(1);

        expect(yield* api.bank.open()).toBe(true);
        expect(calls.bankLoadForces).toEqual([true]);
        expect(calls.bankOpens).toBe(1);

        const disconnected = yield* api.wait.forEvent(
          { type: "connection" },
          {
            trigger: Effect.sync(() => {
              resetBankSession();
              target.onConnection?.("OnConnectionLost");
              return true;
            }),
          },
        );
        expect(disconnected).not.toBeNull();
        expect(yield* api.bank.getAll()).toEqual([]);

        expect(yield* api.bank.open()).toBe(true);
        expect(calls.bankLoadForces).toEqual([true, true]);
        expect(calls.bankOpens).toBe(2);
        expect((yield* api.bank.getAll())[0]?.itemId).toBe(42);

        failNextBankLoad();
        expect(yield* api.bank.load(true)).toBe(false);
        expect(calls.bankLoadForces).toEqual([true, true, true]);
        const retained = yield* api.bank.getAll();
        expect(retained[0]?.itemId).toBe(42);

        const inventoryLoad = yield* api.wait.forPacket(
          {
            command: "loadInventoryBig",
            direction: "extension",
            wireType: "json",
          },
          {
            timeout: "1 second",
            trigger: Effect.sync(() => {
              emitExtension(target, {
                cmd: "loadInventoryBig",
                hitems: [{ ItemID: 60, sName: "Placed House Item" }],
                items: [
                  { ItemID: 50, sName: "Normal Item" },
                  { ItemID: 51, bCoins: 1, sName: "Coin Item" },
                  {
                    ItemID: 52,
                    bWear: 0,
                    sES: "Weapon",
                    sName: "Wearable Item",
                  },
                  {
                    ItemID: 53,
                    bUpg: 1,
                    bWear: 0,
                    sES: "ba",
                    sName: "Member Item",
                  },
                  {
                    ItemID: 54,
                    bWear: 0,
                    sES: "Weapon",
                    sName: "Cosmetic Item",
                  },
                ],
              });
              return true;
            }),
          },
        );
        expect(inventoryLoad).not.toBeNull();

        expect(yield* api.bank.getAvailableSlots()).toBe(0);
        expect(yield* api.bank.deposit(50)).toBe(false);
        expect(yield* api.bank.withdraw(42)).toBe(false);
        expect(yield* api.bank.withdraw(43)).toBe(false);
        expect(calls.deposits).toBe(0);
        expect(calls.withdrawals).toBe(0);

        closeBankUi();
        expect(yield* api.bank.deposit(51)).toBe(true);
        expect(calls.deposits).toBe(1);
        expect(calls.bankOpens).toBe(4);
        expect(calls.bankLoadForces).toEqual([true, true, true]);
        expect(yield* api.bank.contains(51)).toBe(true);
        expect(yield* api.inventory.contains(51)).toBe(false);

        expect(yield* api.bank.swap(50, 42)).toBe(true);
        expect(calls.swaps).toBe(1);
        expect(yield* api.bank.contains(50)).toBe(true);
        expect(yield* api.inventory.contains(42)).toBe(true);

        const playerLoad = yield* api.wait.forPacket(
          {
            command: "initUserDatas",
            direction: "extension",
            wireType: "json",
          },
          {
            timeout: "1 second",
            trigger: Effect.sync(() => {
              emitExtension(target, {
                a: [
                  {
                    data: { strUsername: "Hero" },
                    uid: 1,
                  },
                ],
                cmd: "initUserDatas",
              });
              return true;
            }),
          },
        );
        expect(playerLoad).not.toBeNull();

        expect(yield* api.inventory.wear(54)).toBe(true);
        expect(calls.wears).toBe(1);
        const cosmetic = yield* api.inventory.get(54);
        expect(cosmetic).not.toBeNull();
        expect(cosmetic?.worn).toBe(true);
        expect(cosmetic?.equipped).toBe(false);

        expect(yield* api.inventory.equip(52, { wear: false })).toBe(true);
        expect(calls.equips).toBe(1);
        expect(calls.wears).toBe(1);
        expect((yield* api.inventory.get(52))?.equipped).toBe(true);
        expect((yield* api.inventory.get(52))?.worn).toBe(false);
        expect((yield* api.inventory.get(54))?.worn).toBe(true);

        expect(yield* api.inventory.equip(52)).toBe(true);
        expect(calls.equips).toBe(1);
        expect(calls.wears).toBe(2);
        expect((yield* api.inventory.get(52))?.worn).toBe(true);
        expect((yield* api.inventory.get(54))?.worn).toBe(false);

        expect(yield* api.inventory.wear(52)).toBe(true);
        expect(yield* api.inventory.wear(50)).toBe(false);
        expect(yield* api.inventory.wear(53)).toBe(false);
        expect(calls.wears).toBe(2);

        expect(yield* api.inventory.equip(53)).toBe(false);
        expect(calls.equips).toBe(1);

        expect(yield* api.shops.load(101)).toBe(true);
        closeShopUi();
        expect(yield* api.shops.isOpen(101)).toBe(false);
        expect(yield* api.shops.load(101)).toBe(true);
        expect(calls.shopLoads).toBe(2);
        yield* api.shops.loadHairShop(202);
        expect(calls.actions).toContain("loadShop");
        expect(calls.actions).toContain("loadHairShop");
        expect(calls.actions).toContain("wearItem");
        expect(calls.hairShopLoads).toBe(1);
      }),
    ),
  );
});
