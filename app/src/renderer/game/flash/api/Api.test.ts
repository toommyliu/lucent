import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

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
    bankLoadForces: [] as boolean[],
    deposits: 0,
    equips: 0,
    hairShopLoads: 0,
    wears: 0,
    withdrawals: 0,
  };
  let failBankLoad = false;
  let bankLoaded = false;
  let bankOpen = false;
  let bankItems: readonly unknown[] = [];
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
        { ItemID: "42", iQty: "2", sName: "Indexed Item" },
        {
          ItemID: "43",
          bHouse: 1,
          sName: "Banked House Item",
        },
      ];
      bankLoaded = true;
    },
    "bank.isOpen": () => bankOpen,
    "bank.open": () => {
      calls.bankOpens += 1;
      bankOpen = !bankOpen;
    },
    "bank.withdraw": () => {
      calls.withdrawals += 1;
      return true;
    },
    "flash.callGameFunction": () => {
      calls.wears += 1;
      emitExtension(target, {
        ItemID: 52,
        cmd: "wearItem",
        success: 1,
      });
      return "";
    },
    "house.getSlots": () => 1,
    "inventory.equip": () => {
      calls.equips += 1;
      return true;
    },
    "inventory.getSlots": () => 4,
    "player.isMember": () => false,
    "shops.isOpen": (shopId = 0) =>
      openShopId !== 0 && (shopId === 0 || shopId === openShopId),
    "shops.load": (shopId: number) => {
      openShopId = shopId;
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
    failNextBankLoad: () => {
      failBankLoad = true;
    },
    resetBankSession: () => {
      bankItems = [];
      bankLoaded = false;
      bankOpen = false;
      failBankLoad = false;
    },
    target,
  };
};

describe("Api", () => {
  it.effect("protects container commands and action-locked workflows", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { calls, failNextBankLoad, resetBankSession, target } =
          makeTarget();
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
                  { ItemID: 52, bWear: 0, sName: "Wearable Item" },
                  { ItemID: 53, bUpg: 1, sName: "Member Item" },
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

        expect(yield* api.bank.deposit(51)).toBe(true);
        expect(calls.deposits).toBe(1);
        expect(yield* api.bank.contains(51)).toBe(true);
        expect(yield* api.inventory.contains(51)).toBe(false);

        expect(yield* api.inventory.equip(52)).toBe(true);
        expect(calls.wears).toBe(1);
        expect((yield* api.inventory.get(52))?.equipped).toBe(true);

        expect(yield* api.inventory.equip(53)).toBe(false);
        expect(calls.equips).toBe(1);

        expect(yield* api.shops.load(101)).toBe(true);
        yield* api.shops.loadHairShop(202);
        expect(calls.actions).toContain("loadShop");
        expect(calls.actions).toContain("loadHairShop");
        expect(calls.actions).toContain("wearItem");
        expect(calls.hairShopLoads).toBe(1);
      }),
    ),
  );
});
