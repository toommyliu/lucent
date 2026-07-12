import { normalizeItemQuantity } from "@lucent/game";
import type { ItemQuery } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireBoolean, WireInt } from "../contract/Coercion";
import { packetData } from "../contract/Packet";
import type { Store } from "../state/Store";
import type { Packet } from "./Packet";
import type { Wait } from "./Wait";

const WearResponse = Schema.Struct({
  ItemID: PositiveWireInt,
  success: WireBoolean,
});
const decodeWearResponse = Schema.decodeUnknownOption(WearResponse);

export const makeInventory = (
  bridge: BridgeService,
  store: Store,
  packet: Packet,
  wait: Wait,
) => {
  const getAll = () => store.items.getAll("inventory");

  const get = (selector: ItemQuery) => store.items.get("inventory", selector);

  const getSlots = () =>
    bridge
      .invoke("inventory.getSlots", undefined, WireInt)
      .pipe(Effect.map(Option.getOrElse(() => 0)));

  const getUsedSlots = () =>
    store.items.getAll("inventory").pipe(Effect.map((items) => items.length));

  const contains = (selector: ItemQuery, requested?: number) =>
    get(selector).pipe(
      Effect.map(
        (item) =>
          item !== null && item.quantity >= normalizeItemQuantity(requested),
      ),
    );

  const equip = (selector: ItemQuery) =>
    Effect.gen(function* () {
      const item = yield* get(selector);
      if (item === null) return false;
      if (item.equipped) return true;

      if (item.memberOnly) {
        const member = yield* bridge
          .invoke("player.isMember", undefined, Schema.Boolean)
          .pipe(Effect.map(Option.getOrElse(() => false)));
        if (!member) return false;
      }

      if (!(yield* wait.forGameAction("equipItem"))) return false;
      const sent = yield* bridge
        .invoke("inventory.equip", [{ itemId: item.itemId }], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false)));
      if (!sent) return false;

      if (!item.wearable) {
        return yield* wait.until(
          get(item.itemId).pipe(
            Effect.map((current) => current?.equipped === true),
          ),
          { timeout: "5 seconds" },
        );
      }

      if (!(yield* wait.forGameAction("wearItem"))) return false;
      const map = yield* store.world.getMap;
      let response: typeof WearResponse.Type | undefined;
      const wearPacket = yield* wait.forPacket(
        {
          command: "wearItem",
          direction: "extension",
          predicate: (candidate) => {
            const decoded = decodeWearResponse(packetData(candidate));
            if (
              Option.isNone(decoded) ||
              decoded.value.ItemID !== item.itemId
            ) {
              return false;
            }
            response = decoded.value;
            return true;
          },
          wireType: "json",
        },
        {
          timeout: "5 seconds",
          trigger: packet.sendServer(
            `%xt%zm%wearItem%${map.id}%${item.itemId}%`,
            "String",
          ),
        },
      );
      return wearPacket !== null && response?.success === true;
    });

  const getAvailableSlots = () =>
    Effect.zipWith(getSlots(), getUsedSlots(), (slots, used) =>
      Math.max(0, slots - used),
    );

  const unequipConsumable = (selector: ItemQuery) => {
    return get(selector).pipe(
      Effect.flatMap((item) => {
        if (item === null || item.category !== "Item") {
          return Effect.succeed(false);
        }
        if (!item.equipped) return Effect.succeed(true);
        return wait.forGameAction("unequipItem").pipe(
          Effect.flatMap((ready) =>
            ready
              ? bridge.invoke(
                  "inventory.unequipConsumable",
                  [{ itemId: item.itemId }],
                  Schema.Boolean,
                )
              : Effect.succeed(Option.none()),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (sent) =>
                sent
                  ? wait.until(
                      get(item.itemId).pipe(
                        Effect.map(
                          (current) =>
                            current !== null && current.equipped !== true,
                        ),
                      ),
                      { timeout: "5 seconds" },
                    )
                  : Effect.succeed(false),
            }),
          ),
        );
      }),
    );
  };

  return {
    contains,
    equip,
    get,
    getAll,
    getAvailableSlots,
    getSlots,
    getUsedSlots,
    unequipConsumable,
  };
};

export type Inventory = ReturnType<typeof makeInventory>;
