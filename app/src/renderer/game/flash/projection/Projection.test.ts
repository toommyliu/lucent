import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Event } from "../contract/Event";
import type { Packet } from "../contract/Packet";
import { toItem } from "../contract/payload/Items";
import { makePipeline } from "../protocol/Pipeline";
import { makeStore } from "../state/Store";

const extension = (command: string, data: unknown): Packet => ({
  command,
  data,
  direction: "extension",
  raw: "",
  wireType: "json",
});

describe("Projection", () => {
  it.effect(
    "indexes full item state and retains it after a failed refresh",
    () =>
      Effect.gen(function* () {
        const store = yield* makeStore;
        const events: Event[] = [];
        const pipeline = makePipeline(store, {
          publishEvent: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        });

        yield* pipeline.packet(
          extension("loadInventoryBig", {
            items: [{ ItemID: "7", iQty: "3", sName: "Health Potion" }],
          }),
        );
        expect((yield* store.items.get("inventory", 7))?.quantity).toBe(3);
        expect(
          (yield* store.items.get("inventory", "health potion"))?.itemId,
        ).toBe(7);

        yield* store.items.replace("bank", [
          toItem(
            { ItemID: 99, iQty: 1, sName: "Retained Item" },
            { context: "bank" },
          ),
        ]);
        yield* pipeline.packet(
          extension("loadBank", { bitSuccess: false, items: [] }),
        );
        expect((yield* store.items.get("bank", 99))?.name).toBe(
          "Retained Item",
        );

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
      }),
  );

  it.effect("resets area state and applies combat auras and deaths", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const events: Event[] = [];
      const pipeline = makePipeline(store, {
        publishEvent: (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
      });
      yield* store.auth.setCredentials("Hero", "secret");

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

      yield* pipeline.packet(
        extension("cb", {
          a: [
            {
              auras: [{ nam: "Empowered", dur: "10" }],
              cmd: "aura+",
              tInf: "p:10",
            },
          ],
          m: { "1": { intHP: 0, intState: 0 } },
        }),
      );
      expect((yield* store.world.getPlayerAuras(10))[0]?.name).toBe(
        "Empowered",
      );
      expect(events.some((event) => event.type === "monster-death")).toBe(true);

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
      expect((yield* store.world.getPlayerAuras(10))[0]?.stack).toBe(2);

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
      expect((yield* store.world.getPlayerAuras(10))[0]?.stack).toBe(1);

      yield* pipeline.packet(
        extension("moveToArea", {
          areaId: 13,
          areaName: "yulgar-1",
          monBranch: [],
          uoBranch: [],
        }),
      );
      expect(yield* store.world.getMonsters).toEqual([]);
      expect(yield* store.world.getPlayerAuras(10)).toEqual([]);
    }),
  );
});
