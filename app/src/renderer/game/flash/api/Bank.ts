import { normalizeItemQuantity, toItemSelector } from "@lucent/game";
import type { ItemQuery, LiveItem } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireBoolean, WireInt } from "../contract/Coercion";
import { packetData } from "../contract/Packet";
import type { Store } from "../state/Store";
import type { Auth } from "./Auth";
import type { House } from "./House";
import type { Inventory } from "./Inventory";
import type { Wait } from "./Wait";

const TransferResponse = Schema.Struct({
  ItemID: PositiveWireInt,
  bSuccess: Schema.optionalKey(WireBoolean),
});
const SwapResponse = Schema.Struct({
  bankItemID: PositiveWireInt,
  invItemID: PositiveWireInt,
});

const decodeTransferResponse = Schema.decodeUnknownOption(TransferResponse);
const decodeSwapResponse = Schema.decodeUnknownOption(SwapResponse);

const destinationCanAccept = (itemId: number, destination: Inventory | House) =>
  destination
    .get(itemId)
    .pipe(
      Effect.flatMap((current) =>
        current !== null
          ? Effect.succeed(true)
          : destination
              .getAvailableSlots()
              .pipe(Effect.map((available) => available > 0)),
      ),
    );

export const makeBank = (
  bridge: BridgeService,
  store: Store,
  auth: Auth,
  inventory: Inventory,
  house: House,
  wait: Wait,
) => {
  const isOpen = () =>
    bridge
      .invoke("bank.isOpen", undefined, Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));

  const getAll = () =>
    store.items
      .isHydrated("bank")
      .pipe(
        Effect.flatMap((hydrated) =>
          hydrated ? store.items.getAll("bank") : Effect.succeed([]),
        ),
      );

  const get = (selector: ItemQuery) =>
    store.items
      .isHydrated("bank")
      .pipe(
        Effect.flatMap((hydrated) =>
          hydrated ? store.items.get("bank", selector) : Effect.succeed(null),
        ),
      );

  const getSlots = () =>
    bridge
      .invoke("bank.getSlots", undefined, WireInt)
      .pipe(Effect.map(Option.getOrElse(() => 0)));

  const getUsedSlots = () =>
    getAll().pipe(
      Effect.map((items) => items.filter((item) => !item.coins).length),
    );

  const load = (force = false) =>
    Effect.gen(function* () {
      if (!(yield* auth.isLoggedIn())) return false;

      const version = yield* store.items.getHydrationVersion("bank");
      if (version > 0 && !force) return true;
      const requestForce = force || version === 0;
      const loaded = yield* wait.forPacket(
        { command: "loadBank", direction: "extension", wireType: "json" },
        {
          timeout: "10 seconds",
          trigger: bridge
            .invoke("bank.loadItems", [requestForce], Schema.Void)
            .pipe(Effect.map(Option.isSome)),
        },
      );
      if (loaded === null) return false;
      return (yield* store.items.getHydrationVersion("bank")) > version;
    });

  const open = (force = false) =>
    Effect.gen(function* () {
      if (!(yield* auth.isLoggedIn())) return false;

      if (force) {
        yield* bridge.invoke("bank.loadItems", [true], Schema.Void);
      }

      const opened = yield* isOpen();
      if (opened && !force) return true;
      if (opened) {
        if (
          Option.isNone(
            yield* bridge.invoke("bank.open", undefined, Schema.Void),
          )
        ) {
          return false;
        }

        if (
          !(yield* wait.until(isOpen().pipe(Effect.map((value) => !value)), {
            timeout: "3 seconds",
          }))
        ) {
          return false;
        }
      }

      if (
        Option.isNone(yield* bridge.invoke("bank.open", undefined, Schema.Void))
      ) {
        return false;
      }

      return yield* wait.until(isOpen(), { timeout: "3 seconds" });
    });

  const contains = (selector: ItemQuery, requested?: number) =>
    get(selector).pipe(
      Effect.map(
        (item) =>
          item !== null && item.quantity >= normalizeItemQuantity(requested),
      ),
    );

  const bankCanAccept = (item: LiveItem | null) =>
    Effect.gen(function* () {
      if (item === null || item.coins) return item !== null;
      if ((yield* store.items.get("bank", item.itemId)) !== null) return true;
      return (yield* getAvailableSlots()) > 0;
    });

  const deposit = (selector: ItemQuery) => {
    return Effect.gen(function* () {
      if (!(yield* load())) return false;
      const inventoryItem = yield* inventory.get(selector);
      if (inventoryItem === null || !(yield* bankCanAccept(inventoryItem))) {
        return false;
      }
      let response: typeof TransferResponse.Type | undefined;
      const packet = yield* wait.forPacket(
        {
          command: "bankFromInv",
          direction: "extension",
          predicate: (candidate) => {
            const decoded = decodeTransferResponse(packetData(candidate));
            if (
              Option.isNone(decoded) ||
              decoded.value.ItemID !== inventoryItem.itemId
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
            .invoke("bank.deposit", [toItemSelector(selector)], Schema.Boolean)
            .pipe(Effect.map(Option.getOrElse(() => false))),
        },
      );
      if (packet === null || response?.bSuccess === false) return false;

      const [projectedInventoryItem, projectedBankItem] = yield* Effect.all([
        store.items.get("inventory", inventoryItem.itemId),
        store.items.get("bank", inventoryItem.itemId),
      ]);
      return projectedInventoryItem === null && projectedBankItem !== null;
    });
  };

  const withdraw = (selector: ItemQuery) => {
    return Effect.gen(function* () {
      if (!(yield* load())) return false;
      const bankItem = yield* get(selector);
      if (bankItem === null) return false;
      const destination = bankItem.houseItem ? house : inventory;
      if (!(yield* destinationCanAccept(bankItem.itemId, destination))) {
        return false;
      }
      let response: typeof TransferResponse.Type | undefined;
      const packet = yield* wait.forPacket(
        {
          command: "bankToInv",
          direction: "extension",
          predicate: (candidate) => {
            const decoded = decodeTransferResponse(packetData(candidate));
            if (
              Option.isNone(decoded) ||
              decoded.value.ItemID !== bankItem.itemId
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
            .invoke("bank.withdraw", [toItemSelector(selector)], Schema.Boolean)
            .pipe(Effect.map(Option.getOrElse(() => false))),
        },
      );
      if (packet === null || response?.bSuccess === false) return false;

      const [bank, inventoryItem, houseItem] = yield* Effect.all([
        store.items.get("bank", bankItem.itemId),
        store.items.get("inventory", bankItem.itemId),
        store.items.get("house", bankItem.itemId),
      ]);
      return bank === null && (inventoryItem !== null || houseItem !== null);
    });
  };

  const swap = (inventorySelector: ItemQuery, bankSelector: ItemQuery) => {
    return Effect.gen(function* () {
      if (!(yield* load())) return false;
      const inventoryItem = yield* inventory.get(inventorySelector);
      const bankItem = yield* get(bankSelector);
      if (inventoryItem === null || bankItem === null) {
        return false;
      }
      if (
        bankItem.houseItem &&
        !(yield* destinationCanAccept(bankItem.itemId, house))
      ) {
        return false;
      }
      if (
        !inventoryItem.coins &&
        bankItem.coins &&
        (yield* store.items.get("bank", inventoryItem.itemId)) === null &&
        (yield* getAvailableSlots()) <= 0
      ) {
        return false;
      }
      const packet = yield* wait.forPacket(
        {
          command: "bankSwapInv",
          direction: "extension",
          predicate: (candidate) => {
            const decoded = decodeSwapResponse(packetData(candidate));
            return (
              Option.isSome(decoded) &&
              decoded.value.invItemID === inventoryItem.itemId &&
              decoded.value.bankItemID === bankItem.itemId
            );
          },
          wireType: "json",
        },
        {
          timeout: "5 seconds",
          trigger: bridge
            .invoke(
              "bank.swap",
              [toItemSelector(inventorySelector), toItemSelector(bankSelector)],
              Schema.Boolean,
            )
            .pipe(Effect.map(Option.getOrElse(() => false))),
        },
      );
      if (packet === null) return false;

      const [newBankItem, newInventoryItem, newHouseItem] = yield* Effect.all([
        store.items.get("bank", inventoryItem.itemId),
        store.items.get("inventory", bankItem.itemId),
        store.items.get("house", bankItem.itemId),
      ]);
      return (
        newBankItem !== null &&
        (newInventoryItem !== null || newHouseItem !== null)
      );
    });
  };

  const depositBatch = (selectors: readonly ItemQuery[]) =>
    Effect.forEach(selectors, deposit, { concurrency: 1 });

  const withdrawBatch = (selectors: readonly ItemQuery[]) =>
    Effect.forEach(selectors, withdraw, { concurrency: 1 });

  const getAvailableSlots = () =>
    Effect.zipWith(getSlots(), getUsedSlots(), (slots, used) =>
      Math.max(0, slots - used),
    );

  return {
    contains,
    deposit,
    depositBatch,
    get,
    getAll,
    getAvailableSlots,
    getSlots,
    getUsedSlots,
    isOpen,
    load,
    open,
    swap,
    withdraw,
    withdrawBatch,
  };
};

export type Bank = ReturnType<typeof makeBank>;
