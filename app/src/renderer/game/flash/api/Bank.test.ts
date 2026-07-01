import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import type { FlashProtocolShape } from "../protocol/FlashProtocol";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { ItemsState } from "../state/Items";
import * as ItemsStore from "../state/Items";
import { AuthApi, type AuthApiShape } from "./Auth";
import { BankApi, layer as BankApiLayer } from "./Bank";
import type { WaitApiShape } from "./Wait";
import { WaitApi } from "./Wait";

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
        switch (method) {
          case "bank.deposit":
            return true;
          case "bank.getItem":
            return item(9, "Banked Cape", {
              bBank: true,
              sES: "ba",
              sType: "Cape",
            });
          case "bank.isOpen":
            return false;
          default:
            return bridgeFallbacks[method]();
        }
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
        command: selector?.command ?? "bankFromInv",
        data: { ItemID: 1, bSuccess: true, cmd: selector?.command },
        direction: "server",
        raw: "{}",
        wireType: "json",
      }),
    sendClient: () => Effect.void,
    sendServer: () => Effect.void,
  } satisfies FlashProtocolShape);
  const auth = AuthApi.of({
    connectTo: () =>
      Effect.succeed({
        message: "connected",
        retryable: false,
        status: "connected",
      }),
    getPassword: Effect.succeed("pw"),
    getServers: Effect.succeed([]),
    getUsername: Effect.succeed("hero"),
    isLoggedIn: Effect.succeed(true),
    isTemporarilyKicked: Effect.succeed(false),
    login: () => Effect.succeed(true),
    logout: Effect.void,
  } satisfies AuthApiShape);
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

  return BankApiLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ItemsStore.layer,
        Layer.succeed(AuthApi, auth),
        Layer.succeed(SwfBridge, bridge),
        Layer.succeed(FlashProtocol, protocol),
        Layer.succeed(WaitApi, wait),
      ),
    ),
  );
};

describe("BankApi", () => {
  it.effect("keeps bridge-backed bank reads out of inventory", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly args: readonly unknown[];
        readonly method: string;
      }> = [];
      yield* Effect.gen(function* () {
        const api = yield* BankApi;
        const items = yield* ItemsState;

        expect((yield* api.get("Banked Cape"))?.banked).toBe(true);
        expect(yield* items.get("inventory", "Banked Cape")).toBeNull();
        expect((yield* items.get("bank", "Banked Cape"))?.itemId).toBe(9);
      }).pipe(Effect.provide(makeLayer(calls)));

      expect(calls.map((call) => call.method)).toContain("bank.getItem");
    }),
  );

  it.effect("settles deposit on the bankFromInv packet", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly args: readonly unknown[];
        readonly method: string;
      }> = [];
      yield* Effect.gen(function* () {
        const api = yield* BankApi;
        const items = yield* ItemsState;
        yield* items.replaceInventory([item(1, "Inventory Sword")]);

        expect(yield* api.deposit("Inventory Sword")).toBe(true);
      }).pipe(Effect.provide(makeLayer(calls)));

      expect(calls.map((call) => call.method)).toEqual([
        "bank.isOpen",
        "bank.open",
        "bank.deposit",
      ]);
    }),
  );
});
