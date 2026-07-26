import {
  matchesAppliedEnhancement,
  normalizeItemQuantity,
  resolveEnhancementStrategy,
} from "@lucent/game";
import type { ItemQuery } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import {
  EquipEnhancementSelectorSchema,
  type EquipEnhancementSelector,
} from "../../EnhancementSelectors";
import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireBoolean, WireInt } from "../contract/Coercion";
import { packetData } from "../contract/Packet";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

const WearResponse = Schema.Struct({
  ItemID: PositiveWireInt,
  success: WireBoolean,
  uid: PositiveWireInt,
});
const EquipResponse = Schema.Struct({
  ItemID: PositiveWireInt,
  uid: PositiveWireInt,
});
const decodeWearResponse = Schema.decodeUnknownOption(WearResponse);
const decodeEquipResponse = Schema.decodeUnknownOption(EquipResponse);
const decodeEquipEnhancementSelector = Schema.decodeUnknownOption(
  EquipEnhancementSelectorSchema,
);

export interface EquipOptions {
  /** Whether to wear wearable equipment after equipping it. Defaults to true. */
  readonly wear?: boolean;
}

export const makeInventory = (
  bridge: BridgeService,
  store: Store,
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

  const canUseMemberItem = Effect.fn("Inventory.canUseMemberItem")(function* (
    memberOnly: boolean,
  ) {
    if (!memberOnly) return true;
    return yield* bridge
      .invoke("player.isMember", undefined, Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  });

  const getLocalUserId = Effect.fn("Inventory.getLocalUserId")(function* () {
    const cached = yield* store.world.getSelfEntityId;
    return cached === null
      ? yield* bridge.invoke("player.getUserId", undefined, PositiveWireInt)
      : Option.some(cached);
  });

  const wearItem = Effect.fn("Inventory.wearItem")(function* (itemId: number) {
    const userId = yield* getLocalUserId();
    if (Option.isNone(userId)) return false;
    if (!(yield* wait.forGameAction("wearItem"))) return false;

    let response: typeof WearResponse.Type | undefined;
    const wearPacket = yield* wait.forPacket(
      {
        command: "wearItem",
        direction: "extension",
        predicate: (candidate) => {
          const decoded = decodeWearResponse(packetData(candidate));
          if (
            Option.isNone(decoded) ||
            decoded.value.ItemID !== itemId ||
            decoded.value.uid !== userId.value
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
        trigger: bridge
          .invoke("inventory.wear", [{ itemId }], Schema.Boolean)
          .pipe(Effect.map(Option.getOrElse(() => false))),
      },
    );
    return wearPacket !== null && response?.success === true;
  });

  const wearEffect = Effect.fn("Inventory.wear")(function* (
    selector: ItemQuery,
  ) {
    const item = yield* get(selector);
    if (item === null || !item.wearable) return false;
    if (item.worn) return true;
    if (!(yield* canUseMemberItem(item.memberOnly))) return false;
    return yield* wearItem(item.itemId);
  });
  const wear = (selector: ItemQuery) => wearEffect(selector);

  const equipEffect = Effect.fn("Inventory.equip")(function* (
    selector: ItemQuery,
    options?: EquipOptions,
  ) {
    const item = yield* get(selector);
    if (item === null) return false;

    const needsEquip = !item.equipped;
    const needsWear = (options?.wear ?? true) && item.wearable && !item.worn;
    if (!needsEquip && !needsWear) return true;
    if (!(yield* canUseMemberItem(item.memberOnly))) return false;

    if (needsEquip) {
      if (!(yield* wait.forGameAction("equipItem"))) return false;
      if (item.category === "Item") {
        const sent = yield* bridge
          .invoke("inventory.equip", [{ itemId: item.itemId }], Schema.Boolean)
          .pipe(Effect.map(Option.getOrElse(() => false)));
        if (!sent) return false;

        const equipped = yield* wait.until(
          get(item.itemId).pipe(
            Effect.map((current) => current?.equipped === true),
          ),
          { timeout: "5 seconds" },
        );
        if (!equipped) return false;
      } else {
        const userId = yield* getLocalUserId();
        if (Option.isNone(userId)) return false;
        const equipPacket = yield* wait.forPacket(
          {
            command: "equipItem",
            direction: "extension",
            predicate: (candidate) => {
              const decoded = decodeEquipResponse(packetData(candidate));
              return (
                Option.isSome(decoded) &&
                decoded.value.ItemID === item.itemId &&
                decoded.value.uid === userId.value
              );
            },
            wireType: "json",
          },
          {
            timeout: "5 seconds",
            trigger: bridge
              .invoke(
                "inventory.equip",
                [{ itemId: item.itemId }],
                Schema.Boolean,
              )
              .pipe(Effect.map(Option.getOrElse(() => false))),
          },
        );
        if (equipPacket === null) return false;
      }
    }

    return needsWear ? yield* wearItem(item.itemId) : true;
  });
  const equip = (selector: ItemQuery, options?: EquipOptions) =>
    equipEffect(selector, options);

  const equipByEnhancementEffect = Effect.fn("Inventory.equipByEnhancement")(
    function* (selector: EquipEnhancementSelector) {
      const decoded = decodeEquipEnhancementSelector(selector);
      if (Option.isNone(decoded)) return false;
      const normalized = decoded.value;
      if (
        normalized.slot === undefined &&
        normalized.special === undefined &&
        normalized.enhancement.toLowerCase() === "forge"
      ) {
        return false;
      }

      const items = yield* getAll();
      let target: (typeof items)[number] | undefined;
      for (const item of items) {
        if (item.category.trim().toLowerCase() === "enhancement") continue;
        const resolution = resolveEnhancementStrategy(
          item,
          normalized.enhancement,
          item.enhancement?.level ?? 0,
          normalized.special,
        );
        if (
          !resolution.ok ||
          (normalized.slot !== undefined &&
            resolution.strategy.slot !== normalized.slot) ||
          !matchesAppliedEnhancement(item, resolution.strategy)
        ) {
          continue;
        }
        if (
          target === undefined ||
          (item.enhancement?.level ?? 0) > (target.enhancement?.level ?? 0)
        ) {
          target = item;
        }
      }
      return target === undefined ? false : yield* equip(target.itemId);
    },
  );
  const equipByEnhancement = (selector: EquipEnhancementSelector) =>
    equipByEnhancementEffect(selector);

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
    equipByEnhancement,
    get,
    getAll,
    getAvailableSlots,
    getSlots,
    getUsedSlots,
    unequipConsumable,
    wear,
  };
};

export type Inventory = ReturnType<typeof makeInventory>;
