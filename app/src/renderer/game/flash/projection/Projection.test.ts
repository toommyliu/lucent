import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Event } from "../contract/Event";
import type { Packet } from "../contract/Packet";
import { toItem } from "../contract/payload/Items";
import { makeBridge } from "../bridge/Bridge";
import { makePipeline, type ProjectionTrace } from "../protocol/Pipeline";
import { makeStore } from "../state/Store";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {},
});

const extension = (command: string, data: unknown): Packet => ({
  command,
  data,
  direction: "extension",
  raw: "",
  wireType: "json",
});

const server = (command: string, data: unknown): Packet => ({
  command,
  data,
  direction: "server",
  raw: "",
  wireType: "json",
});

const client = (command: string, params: readonly string[]): Packet => ({
  command,
  direction: "client",
  params,
  raw: params.join("%"),
  wireType: "str",
});

const bridgeTarget = (methods: Record<string, () => unknown>) =>
  ({ swf: methods }) as unknown as Pick<Window, "swf">;

describe("Projection", () => {
  it.effect(
    "indexes valid item entries without rejecting a mixed container",
    () =>
      Effect.gen(function* () {
        const store = yield* makeStore;
        const diagnostics: string[] = [];
        const events: Event[] = [];
        const traces: ProjectionTrace[] = [];
        const pipeline = makePipeline(store, {
          publishEvent: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          reportDiagnostic: (operation) =>
            Effect.sync(() => {
              diagnostics.push(operation);
            }),
          reportProjectionTrace: (_operation, trace) =>
            Effect.sync(() => {
              traces.push(trace);
            }),
        });

        yield* pipeline.packet(
          extension("loadInventoryBig", {
            items: [
              {
                CharItemID: "77",
                EnhID: -1,
                ItemID: "7",
                iQty: "3",
                sName: "Health Potion",
              },
              { sName: "Invalid entry" },
            ],
          }),
        );
        expect((yield* store.items.get("inventory", 7))?.quantity).toBe(3);
        expect(
          (yield* store.items.get("inventory", "health potion"))?.itemId,
        ).toBe(7);
        expect(diagnostics).toEqual(["items:loadInventoryBig:entries"]);

        yield* store.items.replace("bank", [
          toItem(
            {
              CharItemID: 88,
              ItemID: 8,
              iQty: 2,
              sName: "Bank Item",
            },
            { context: "bank" },
          ),
        ]);
        yield* pipeline.packet(
          extension("bankSwapInv", { bankItemID: 8, invItemID: 7 }),
        );
        expect((yield* store.items.get("bank", 7))?.name).toBe("Health Potion");
        expect((yield* store.items.get("inventory", 8))?.name).toBe(
          "Bank Item",
        );

        yield* pipeline.packet(
          extension("sellItem", { CharItemID: 88, iQty: 1 }),
        );
        expect((yield* store.items.get("inventory", 8))?.quantity).toBe(1);

        yield* store.world.setSelf("Hero");
        yield* pipeline.packet(
          extension("equipItem", { ItemID: 8, strES: "Weapon" }),
        );
        expect((yield* store.items.get("inventory", 8))?.equipped).toBe(true);
        yield* pipeline.packet(extension("unequipItem", { ItemID: 8 }));
        expect((yield* store.items.get("inventory", 8))?.equipped).toBe(false);

        yield* pipeline.packet(
          extension("dropItem", {
            items: {
              bad: { sName: "Invalid drop" },
              valid: { ItemID: 9, iQty: 2, sName: "Dropped Item" },
            },
          }),
        );
        expect((yield* store.items.get("drop", 9))?.quantity).toBe(2);

        yield* store.items.replace(
          "shop",
          [
            { ItemID: 7, ShopItemID: 70, iQty: 1, sName: "Indexed Shop Item" },
          ].map((payload) => toItem(payload, { context: "shop" })),
        );
        expect(
          (yield* store.items.get("shop", { itemId: 7 }))?.shopItemId,
        ).toBe(70);
        expect(events).toEqual([]);
        expect(traces).toHaveLength(6);
        expect(traces[0]).toMatchObject({
          before: expect.any(Object),
          diff: expect.any(Object),
          packet: { command: "loadInventoryBig" },
        });
      }),
  );

  it.effect(
    "projects house inventory and House-specific equipment changes",
    () =>
      Effect.gen(function* () {
        const store = yield* makeStore;
        const pipeline = makePipeline(store, {
          publishEvent: () => Effect.void,
        });

        yield* pipeline.packet(
          extension("loadInventoryBig", { hitems: [], items: [] }),
        );
        expect(yield* store.items.getAll("house")).toEqual([]);

        yield* pipeline.packet(
          extension("loadInventoryBig", {
            hitems: [
              {
                CharItemID: 1_001,
                ItemID: 101,
                bEquip: 1,
                bHouse: 1,
                sES: "ho",
                sName: "First House",
                sType: "House",
              },
              {
                CharItemID: 1_002,
                ItemID: 102,
                bEquip: 0,
                bHouse: 1,
                sES: "ho",
                sName: "Second House",
                sType: "House",
              },
              {
                CharItemID: 1_003,
                ItemID: 103,
                bEquip: 1,
                bHouse: 1,
                sES: "hi",
                sName: "Placed Chair",
                sType: "Floor Item",
              },
            ],
            items: [],
          }),
        );

        yield* pipeline.packet(
          client("equipItem", ["xt", "zm", "equipItem", "1", "102"]),
        );
        expect((yield* store.items.get("house", 101))?.equipped).toBe(false);
        expect((yield* store.items.get("house", 102))?.equipped).toBe(true);
        expect((yield* store.items.get("house", 103))?.equipped).toBe(true);

        yield* pipeline.packet(
          extension("equipItem", { ItemID: 101, strES: "ho" }),
        );
        expect((yield* store.items.get("house", 101))?.equipped).toBe(true);
        expect((yield* store.items.get("house", 102))?.equipped).toBe(false);

        yield* pipeline.packet(
          client("equipItem", ["xt", "zm", "equipItem", "1", "103"]),
        );
        expect((yield* store.items.get("house", 101))?.equipped).toBe(true);
        expect((yield* store.items.get("house", 103))?.equipped).toBe(true);
      }),
  );

  it.effect("projects successful purchases from current shop metadata", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const diagnostics: string[] = [];
      const pipeline = makePipeline(store, {
        publishEvent: () => Effect.void,
        reportDiagnostic: (operation) =>
          Effect.sync(() => {
            diagnostics.push(operation);
          }),
      });

      yield* store.items.replace(
        "shop",
        [
          {
            ItemID: 201,
            ShopItemID: 2_001,
            bHouse: true,
            sES: "ho",
            sName: "First Purchased House",
            sType: "House",
          },
          {
            ItemID: 202,
            ShopItemID: 2_002,
            bHouse: true,
            sES: "ho",
            sName: "Additional House",
            sType: "House",
          },
          {
            ItemID: 203,
            ShopItemID: 2_003,
            bHouse: true,
            sES: "hi",
            sName: "Purchased Chair",
            sType: "Floor Item",
          },
          {
            ItemID: 204,
            ShopItemID: 2_004,
            bHouse: true,
            sES: "ho",
            sName: "Banked House",
            sType: "House",
          },
        ].map((payload) => toItem(payload, { context: "shop" })),
      );

      yield* pipeline.packet(
        extension("buyItem", {
          CharItemID: 3_001,
          ItemID: 201,
          bBank: 0,
          bitSuccess: 1,
          iQty: 1,
        }),
      );
      expect((yield* store.items.get("house", 201))?.charItemId).toBe(3_001);
      expect((yield* store.items.get("house", 201))?.equipped).toBe(true);

      yield* pipeline.packet(
        extension("buyItem", {
          CharItemID: 3_002,
          ItemID: 202,
          bBank: 0,
          bitSuccess: 1,
          iQty: 1,
        }),
      );
      expect((yield* store.items.get("house", 202))?.equipped).toBe(false);

      yield* pipeline.packet(
        extension("buyItem", {
          CharItemID: 3_003,
          ItemID: 203,
          bBank: 0,
          bitSuccess: 1,
          iQty: 2,
        }),
      );
      expect((yield* store.items.get("house", 203))?.quantity).toBe(2);
      expect((yield* store.items.get("house", 203))?.equipped).toBe(false);

      yield* pipeline.packet(
        extension("buyItem", {
          CharItemID: 3_004,
          ItemID: 204,
          bBank: 1,
          bitSuccess: 1,
          iQty: 1,
        }),
      );
      expect((yield* store.items.get("bank", 204))?.context).toBe("bank");
      expect(yield* store.items.get("house", 204)).toBeNull();

      yield* pipeline.packet(extension("buyItem", { bitSuccess: 0 }));
      expect(yield* store.items.get("house", 205)).toBeNull();
      expect(diagnostics).toEqual([]);

      yield* pipeline.packet(
        extension("buyItem", {
          CharItemID: 3_005,
          bBank: 0,
          bitSuccess: 1,
          iQty: 1,
        }),
      );
      expect(diagnostics).toEqual(["items:buyItem"]);
    }),
  );

  it.effect("consumes temporary requirements on quest turn-in", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const pipeline = makePipeline(store, {
        publishEvent: () => Effect.void,
      });

      yield* pipeline.packet(
        extension("forceAddItem", {
          items: {
            temporary: {
              ItemID: 100,
              bTemp: 1,
              iQty: 3,
              sName: "Quest Drop",
            },
          },
        }),
      );
      expect((yield* store.items.get("temporary", 100))?.quantity).toBe(3);

      yield* pipeline.packet(extension("turnIn", { sItems: "100:2" }));
      expect((yield* store.items.get("temporary", 100))?.quantity).toBe(1);

      yield* pipeline.packet(extension("turnIn", { sItems: "100:1" }));
      expect(yield* store.items.get("temporary", 100)).toBeNull();
    }),
  );

  it.effect("derives omitted item ids from item record keys", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      let addItemsChanged: boolean | undefined;
      const pipeline = makePipeline(store, {
        publishEvent: () => Effect.void,
        reportProjectionTrace: (operation, trace) =>
          Effect.sync(() => {
            if (operation === "projection:addItems") {
              addItemsChanged = trace.changed;
            }
          }),
      });

      yield* store.items.replace("inventory", [
        toItem(
          {
            CharItemID: 200,
            EnhID: -1,
            ItemID: 12_917,
            iQty: 200,
            sName: "Scroll of Enrage",
          },
          { context: "inventory" },
        ),
      ]);
      yield* pipeline.packet(
        extension("addItems", {
          items: {
            "12917": {
              CharItemID: 200,
              bBank: 0,
              iQty: 200,
              iQtyNow: 400,
            },
          },
          msg: "",
        }),
      );
      expect((yield* store.items.get("inventory", 12_917))?.quantity).toBe(400);
      expect(addItemsChanged).toBe(true);
      yield* pipeline.packet(
        extension("forceAddItem", {
          items: {
            scroll: {
              ItemID: 12_917,
              iQty: 200,
              iQtyNow: 450,
            },
          },
        }),
      );
      expect((yield* store.items.get("inventory", 12_917))?.quantity).toBe(450);
    }),
  );

  it.effect("resets area state and applies combat auras and deaths", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* makeStore;
        let userIdReads = 0;
        let locationReads = 0;
        let worldLoaded = false;
        const bridge = yield* makeBridge(
          bridgeTarget({
            "player.getCell": () => {
              locationReads += 1;
              return "Boss";
            },
            "player.getPad": () => {
              locationReads += 1;
              return "Right";
            },
            "player.getUserId": () => {
              userIdReads += 1;
              return 10;
            },
            "world.isLoaded": () => worldLoaded,
          }),
        );
        const events: Event[] = [];
        const pipeline = makePipeline(
          store,
          {
            publishEvent: (event) =>
              Effect.sync(() => {
                events.push(event);
              }),
          },
          bridge,
        );

        yield* pipeline.packet(
          extension("initUserDatas", {
            a: [
              {
                data: {
                  intHP: "90",
                  intHPMax: "100",
                  strUsername: "Hero",
                },
                uid: "10",
              },
            ],
          }),
        );
        expect((yield* store.world.getMe)?.hp).toBe(90);

        yield* pipeline.packet(
          extension("uotls", { o: { intHP: "80" }, unm: "Hero" }),
        );
        expect((yield* store.world.getMe)?.hp).toBe(80);

        yield* pipeline.packet(
          server("moveToArea", {
            areaId: 99,
            areaName: "duplicate-99",
            monBranch: [],
            uoBranch: [],
          }),
        );
        expect((yield* store.world.getMap).id).toBe(0);

        yield* pipeline.packet(
          extension("moveToArea", {
            areaId: 12,
            areaName: "battleon-42",
            monBranch: [
              {
                MonID: 5,
                MonMapID: 1,
                intHP: 100,
                intHPMax: 100,
                strMonName: "Slime",
              },
            ],
            uoBranch: [
              {
                entID: 10,
                intHP: 100,
                intHPMax: 100,
                strUsername: "Hero",
              },
            ],
          }),
        );
        expect((yield* store.world.getMap).roomNumber).toBe(42);
        expect((yield* store.world.getMe)?.username).toBe("Hero");

        yield* pipeline.packet(extension("ct", { m: { "1": { intHP: 20 } } }));
        expect((yield* store.world.getMonster(1))?.hp).toBe(100);
        yield* pipeline.packet(server("ct", { m: { "1": { intHP: 80 } } }));
        expect((yield* store.world.getMonster(1))?.hp).toBe(80);

        yield* pipeline.packet(
          client("moveToCell", [
            "xt",
            "zm",
            "moveToCell",
            "12",
            "Battle",
            "Left",
          ]),
        );
        expect((yield* store.world.getMe)?.cell).toBe("Battle");
        expect((yield* store.world.getMe)?.pad).toBe("Left");

        yield* pipeline.packet(
          client("mv", ["xt", "zm", "mv", "12", "320", "240", "8"]),
        );
        expect((yield* store.world.getMe)?.position).toEqual({
          x: 320,
          y: 240,
        });

        yield* pipeline.packet({
          command: "mtcid",
          data: ["mtcid", "4"],
          direction: "extension",
          raw: "",
          wireType: "str",
        });
        expect((yield* store.world.getMe)?.cell).toBe("Battle");
        expect((yield* store.world.getMe)?.pad).toBe("Left");
        expect(locationReads).toBe(0);

        worldLoaded = true;
        yield* pipeline.packet({
          command: "mtcid",
          data: ["mtcid", "4"],
          direction: "extension",
          raw: "",
          wireType: "str",
        });
        expect((yield* store.world.getMe)?.cell).toBe("Boss");
        expect((yield* store.world.getMe)?.pad).toBe("Right");
        expect(locationReads).toBe(2);

        yield* pipeline.packet(
          extension("cb", {
            a: [
              { cmd: "unsupported-aura", tInf: "p:10" },
              {
                auras: [{ nam: "Empowered", dur: "10" }],
                cmd: "aura+",
                tInf: "p:10",
              },
            ],
            m: { "1": { intHP: 0, intState: 0 } },
          }),
        );
        expect((yield* store.world.getPlayer(10))?.auras[0]?.name).toBe(
          "Empowered",
        );
        expect(events.some((event) => event.type === "monster-death")).toBe(
          true,
        );

        yield* pipeline.packet(
          extension("cb", {
            a: [
              {
                auras: [
                  {
                    dur: "6",
                    icon: "scroll-enrage",
                    nam: "Focus",
                  },
                ],
                cInf: "p:10",
                cmd: "aura+",
                tInf: "m:1",
              },
            ],
          }),
        );
        expect((yield* store.world.getMonster(1))?.auras[0]?.name).toBe(
          "Focus",
        );
        expect(
          events.find(
            (event) => event.type === "aura-added" && event.name === "Focus",
          ),
        ).toEqual({
          type: "aura-added",
          duration: 6,
          icon: "scroll-enrage",
          name: "Focus",
          sourceId: 10,
          sourceType: "player",
          targetId: 1,
          targetType: "monster",
        });

        yield* pipeline.packet(
          extension("respawnMon", ["respawnMon", "", "1"]),
        );
        expect((yield* store.world.getMonster(1))?.auras).toEqual([]);

        yield* pipeline.packet(
          extension("cb", {
            a: [
              {
                auras: [{ nam: "Empowered", dur: 10 }],
                cmd: "aura++",
                tInf: "p:10",
              },
            ],
          }),
        );
        expect((yield* store.world.getPlayer(10))?.auras[0]?.stack).toBe(2);

        yield* pipeline.packet(
          extension("cb", {
            a: [
              {
                aura: { nam: "Empowered" },
                cmd: "aura--",
                tInf: "p:10",
              },
            ],
          }),
        );
        expect((yield* store.world.getPlayer(10))?.auras[0]?.stack).toBe(1);

        yield* pipeline.packet(
          extension("moveToArea", {
            areaId: 13,
            areaName: "yulgar-1",
            monBranch: [],
            uoBranch: [],
          }),
        );
        expect(yield* store.world.getMonsters).toEqual([]);
        expect(yield* store.world.getPlayer(10)).toBeNull();
        expect(userIdReads).toBe(1);
      }),
    ),
  );
});
