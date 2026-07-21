import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Packet } from "../contract/Packet";
import { makePipeline } from "../protocol/Pipeline";
import { makeStore } from "../state/Store";
import { makeProjectionReadiness } from "./ProjectionReadiness";

const extension = (command: string, data: unknown): Packet => ({
  command,
  data,
  direction: "extension",
  raw: "",
  wireType: "json",
});

describe("ProjectionReadiness", () => {
  it.effect(
    "becomes ready after local world and item state are projected, then resets for a new connection",
    () =>
      Effect.gen(function* () {
        const store = yield* makeStore;
        const readiness = makeProjectionReadiness(store);
        const pipeline = makePipeline(store, {
          publishEvent: () => Effect.void,
        });
        yield* store.auth.setCredentials("Hero", "");

        expect(yield* readiness.get()).toEqual({
          houseInventory: false,
          inventory: false,
          map: false,
          player: false,
        });

        yield* pipeline.packet(
          extension("loadInventoryBig", {
            hitems: [
              {
                ItemID: 2,
                bEquip: 1,
                sName: "Hero's House",
                sType: "House",
              },
            ],
            items: [{ ItemID: 1, sName: "Inventory Item" }],
          }),
        );
        expect(yield* readiness.get()).toEqual({
          houseInventory: true,
          inventory: true,
          map: false,
          player: false,
        });
        expect(yield* readiness.isReady()).toBe(false);

        yield* pipeline.packet(
          extension("moveToArea", {
            areaId: 1,
            areaName: "battleon-1",
            monBranch: [],
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
        expect(yield* readiness.isReady()).toBe(true);

        yield* pipeline.runtime({
          status: "OnConnection",
          type: "connection",
        });
        expect(yield* readiness.get()).toEqual({
          houseInventory: false,
          inventory: false,
          map: false,
          player: false,
        });
      }),
  );

  it.effect("treats null item arrays as authoritative empty projections", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const readiness = makeProjectionReadiness(store);
      const pipeline = makePipeline(store, {
        publishEvent: () => Effect.void,
      });

      yield* pipeline.packet(
        extension("loadInventoryBig", {
          hitems: null,
          items: null,
        }),
      );

      expect(yield* readiness.get()).toMatchObject({
        houseInventory: true,
        inventory: true,
      });
    }),
  );
});
