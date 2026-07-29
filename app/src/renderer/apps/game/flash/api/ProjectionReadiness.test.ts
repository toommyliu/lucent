import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { Bridge, makeBridge } from "../bridge/Bridge";
import { makeGateway } from "../bridge/Gateway";
import type { Packet } from "../contract/Packet";
import { makePipeline } from "../protocol/Pipeline";
import { makeWait } from "../protocol/Wait";
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

  it.effect(
    "projects a raw callback initialization sequence before becoming ready",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const target = {
            swf: {
              "player.getUserId": () => 10,
            },
          } as unknown as Window;
          const bridge = yield* makeBridge(target);
          const gateway = yield* makeGateway(target).pipe(
            Effect.provideService(Bridge, bridge),
          );
          const store = yield* makeStore;
          const readiness = makeProjectionReadiness(store);
          const pipeline = makePipeline(
            store,
            { publishEvent: () => Effect.void },
            bridge,
          );
          yield* store.auth.setCredentials("Hero", "");
          yield* gateway.start(pipeline.packet, pipeline.runtime);

          target.onConnection?.("OnConnection");
          target.onExtensionResponse?.(
            JSON.stringify({
              dataObj: {
                cmd: "loadInventoryBig",
                hitems: [
                  {
                    ItemID: "2",
                    bEquip: "1",
                    sName: "Hero's House",
                    sType: "House",
                  },
                ],
                items: [{ ItemID: "1", iQty: "3", sName: "Potion" }],
              },
              type: "json",
            }),
          );
          target.onExtensionResponse?.(
            JSON.stringify({
              dataObj: {
                areaId: "12",
                areaName: "battleon-42",
                cmd: "moveToArea",
                monBranch: [],
                uoBranch: [],
              },
              type: "json",
            }),
          );
          const playerBaseline = yield* makeWait(gateway).forPacket(
            { command: "uotls", direction: "extension" },
            {
              timeout: "1 second",
              trigger: Effect.sync(() => {
                target.onExtensionResponse?.(
                  JSON.stringify({
                    dataObj: {
                      cmd: "uotls",
                      o: {
                        entID: "10",
                        intHP: "100",
                        intHPMax: "100",
                        strFrame: "Enter",
                      },
                      unm: "Hero",
                    },
                    type: "json",
                  }),
                );
                return true;
              }),
            },
          );

          expect(playerBaseline).not.toBeNull();
          expect(yield* readiness.isReady()).toBe(true);
          expect((yield* store.items.get("inventory", 1))?.quantity).toBe(3);
          expect((yield* store.items.get("house", 2))?.equipped).toBe(true);
          expect((yield* store.world.getMap).roomNumber).toBe(42);
          expect((yield* store.world.getMe)?.username).toBe("Hero");
        }),
      ),
  );

  it.effect(
    "keeps malformed or sparse container baselines explicitly unready",
    () =>
      Effect.gen(function* () {
        const store = yield* makeStore;
        const readiness = makeProjectionReadiness(store);
        const pipeline = makePipeline(store, {
          publishEvent: () => Effect.void,
        });

        yield* pipeline.packet(
          extension("loadInventoryBig", {
            hitems: null,
            items: [
              { ItemID: "1", sName: "Valid Item" },
              { sName: "Missing item id" },
            ],
          }),
        );
        expect(yield* readiness.inspect()).toMatchObject({
          failures: {
            inventory:
              "items:loadInventoryBig:entries contained 1 malformed item entries",
          },
          missing: expect.arrayContaining(["inventory", "map", "player"]),
          state: {
            houseInventory: true,
            inventory: false,
          },
        });
        expect(yield* store.items.get("inventory", 1)).not.toBeNull();

        yield* pipeline.packet(
          extension("loadInventoryBig", {
            items: [],
          }),
        );
        expect(yield* readiness.inspect()).toMatchObject({
          failures: {
            houseInventory: "loadInventoryBig omitted hitems",
          },
          state: {
            houseInventory: false,
            inventory: true,
          },
        });
      }),
  );
});
