import { Context, Effect, Layer, Semaphore } from "effect";
import type { Duration } from "effect";

import type { Item, ItemSelector } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { asBoolean, asPositiveInt, asRecord } from "../payload";
import { FlashProtocol } from "../protocol/FlashProtocol";
import type { FlashProtocolShape } from "../protocol/FlashProtocol";
import { normalizeItemSelector } from "../selectors";
import { DropsState } from "../state/Drops";
import type { DropsStateShape } from "../state/Drops";
import { ItemsState } from "../state/Items";
import type { ItemsStateShape } from "../state/Items";
import { observePacketDuring } from "./ActionVerification";
import { AuthApi } from "./Auth";
import type { AuthApiShape } from "./Auth";

export interface DropsApiShape {
  readonly accept: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly contains: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly getAll: () => Effect.Effect<readonly Item[]>;
  readonly isCustomUiEnabled: () => Effect.Effect<boolean>;
  readonly reject: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly toggleUi: () => Effect.Effect<void>;
}

export class DropsApi extends Context.Service<DropsApi, DropsApiShape>()(
  "lucent/game/flash/api/Drops",
) {}

type AcceptedDropContainer = "bank" | "house" | "inventory";

const acceptedItemContainer = (
  drop: Item,
  payload: Record<string, unknown>,
): AcceptedDropContainer => {
  if (asBoolean(payload["bBank"]) === true) {
    return "bank";
  }
  if (drop.houseItem || asBoolean(payload["bHouse"]) === true) {
    return "house";
  }
  return "inventory";
};

interface DropsBridgePort {
  readonly acceptDrop: (itemId: number) => Effect.Effect<boolean>;
  readonly isCustomUiEnabled: () => Effect.Effect<boolean>;
  readonly rejectDrop: (itemId: number) => Effect.Effect<void>;
  readonly toggleUi: () => Effect.Effect<void>;
}

export interface DropsApiPorts {
  readonly acceptTimeout?: Duration.Input;
  readonly auth: Pick<AuthApiShape, "isLoggedIn">;
  readonly bridge: DropsBridgePort;
  readonly drops: Pick<
    DropsStateShape,
    "contains" | "get" | "getAll" | "remove"
  >;
  readonly items: Pick<ItemsStateShape, "get" | "removeDrop">;
  readonly protocol: Pick<FlashProtocolShape, "onPacket">;
}

export const makeDropsApi = (
  ports: DropsApiPorts,
): Effect.Effect<DropsApiShape> =>
  Effect.gen(function* () {
    const acceptSemaphore = yield* Semaphore.make(1);

    const resolveDrop = (selector: ItemSelector) =>
      Effect.gen(function* () {
        const normalized = normalizeItemSelector(selector);
        if (normalized === null) {
          return null;
        }
        return yield* ports.drops.get(selector);
      });

    const waitForAcceptResponse = (itemId: number) =>
      Effect.gen(function* () {
        const result = yield* observePacketDuring(
          ports.protocol,
          { command: "getDrop", direction: "extension", wireType: "json" },
          (packet) => {
            console.log(packet);
            if (packet.direction === "client") {
              console.log('failed here');
              return false;
            }

            const payload = asRecord(packet.data);
            return asPositiveInt(payload?.["ItemID"]) === itemId;
          },
          ports.bridge.acceptDrop(itemId),
          {
            shouldAwait: (sent) => sent,
            timeout: ports.acceptTimeout ?? "10 seconds",
          },
        );

        return result.packet === null || result.packet.direction === "client"
          ? null
          : asRecord(result.packet.data);
      });

    const quantityIn = (container: AcceptedDropContainer, itemId: number) =>
      ports.items
        .get(container, { itemId })
        .pipe(Effect.map((item) => item?.quantity ?? 0));

    return {
      accept: (selector) =>
        acceptSemaphore.withPermits(1)(
          Effect.gen(function* () {
            if (!(yield* ports.auth.isLoggedIn())) {
              return false;
            }

            const drop = yield* resolveDrop(selector);
            if (drop === null) {
              return false;
            }

            const quantityBefore = yield* Effect.all({
              bank: quantityIn("bank", drop.itemId),
              house: quantityIn("house", drop.itemId),
              inventory: quantityIn("inventory", drop.itemId),
            });
            const response = yield* waitForAcceptResponse(drop.itemId);
            if (response === null || asBoolean(response["bSuccess"]) !== true) {
              return false;
            }

            const quantityNow = asPositiveInt(response["iQtyNow"]);
            const quantityAdded = asPositiveInt(response["iQty"]);
            const container = acceptedItemContainer(drop, response);
            const expectedQuantity =
              quantityNow ??
              (quantityAdded === undefined
                ? undefined
                : quantityBefore[container] + quantityAdded);
            const owned = yield* ports.items.get(container, {
              itemId: drop.itemId,
            });
            if (
              expectedQuantity === undefined ||
              owned === null ||
              owned.quantity < expectedQuantity
            ) {
              yield* ports.items.removeDrop(drop.itemId);
              yield* ports.drops.remove(drop.itemId);
              return false;
            }

            yield* ports.items.removeDrop(drop.itemId);
            yield* ports.drops.remove(drop.itemId);
            return true;
          }),
        ),
      contains: ports.drops.contains,
      getAll: ports.drops.getAll,
      isCustomUiEnabled: ports.bridge.isCustomUiEnabled,
      reject: (selector) =>
        Effect.gen(function* () {
          if (!(yield* ports.auth.isLoggedIn())) {
            return false;
          }

          const drop = yield* resolveDrop(selector);
          if (drop === null) {
            return false;
          }

          yield* ports.bridge.rejectDrop(drop.itemId);
          yield* ports.items.removeDrop(drop.itemId);
          yield* ports.drops.remove(drop.itemId);
          return true;
        }),
      toggleUi: ports.bridge.toggleUi,
    };
  });

export const layer = Layer.effect(
  DropsApi,
  Effect.gen(function* () {
    const auth = yield* AuthApi;
    const bridge = yield* SwfBridge;
    const drops = yield* DropsState;
    const items = yield* ItemsState;
    const protocol = yield* FlashProtocol;
    const api = yield* makeDropsApi({
      auth,
      bridge: {
        acceptDrop: (itemId) => bridge.call("drops.acceptDrop", [itemId]),
        isCustomUiEnabled: () => bridge.call("drops.isUsingCustomDrops"),
        rejectDrop: (itemId) => bridge.call("drops.rejectDrop", [itemId]),
        toggleUi: () => bridge.call("drops.toggleUi"),
      },
      drops,
      items,
      protocol,
    });

    return DropsApi.of(api);
  }),
);
