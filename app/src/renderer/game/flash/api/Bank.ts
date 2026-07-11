import { normalizeItemQuantity, toItemSelector } from "@lucent/game";
import type { ItemQuery } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { WireInt } from "../contract/Coercion";
import { ItemPayload, ItemPayloads, toItem } from "../contract/payload/Items";
import type { Store } from "../state/Store";
import type { Auth } from "./Auth";
import type { Wait } from "./Wait";

const NullableItem = Schema.NullOr(ItemPayload);

export const makeBank = (
  bridge: BridgeService,
  store: Store,
  auth: Auth,
  wait: Wait,
) => {
  const isOpen = () =>
    bridge
      .invoke("bank.isOpen", undefined, Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  const getAll = () =>
    bridge.invoke("bank.getItems", undefined, ItemPayloads).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => store.items.getAll("bank"),
          onSome: (payloads) => {
            const items = payloads.map((payload) =>
              toItem(payload, { context: "bank" }),
            );
            return store.items.replace("bank", items).pipe(Effect.as(items));
          },
        }),
      ),
    );
  const get = (selector: ItemQuery) => {
    return store.items.get("bank", selector).pipe(
      Effect.flatMap((cached) =>
        cached !== null
          ? Effect.succeed(cached)
          : bridge
              .invoke("bank.getItem", [toItemSelector(selector)], NullableItem)
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.succeed(null),
                    onSome: (payload) => {
                      if (payload === null) return Effect.succeed(null);
                      const item = toItem(payload, { context: "bank" });
                      return store.items.upsert("bank", item);
                    },
                  }),
                ),
              ),
      ),
    );
  };
  const getSlots = () =>
    bridge
      .invoke("bank.getSlots", undefined, WireInt)
      .pipe(Effect.map(Option.getOrElse(() => 0)));
  const getUsedSlots = () =>
    store.items.getAll("bank").pipe(Effect.map((items) => items.length));
  const open = (force = false) =>
    Effect.gen(function* () {
      if (!(yield* auth.isLoggedIn())) return false;
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

  const deposit = (selector: ItemQuery) => {
    return Effect.gen(function* () {
      const inventoryItem = yield* store.items.get("inventory", selector);
      if (inventoryItem === null || !(yield* open())) return false;
      const sent = yield* bridge
        .invoke("bank.deposit", [toItemSelector(selector)], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false)));
      if (!sent) return false;
      return yield* wait.until(
        Effect.all([
          store.items.get("inventory", inventoryItem.itemId),
          store.items.get("bank", inventoryItem.itemId),
        ]).pipe(
          Effect.map(
            ([inventory, bank]) => inventory === null && bank !== null,
          ),
        ),
        { timeout: "5 seconds" },
      );
    });
  };

  const withdraw = (selector: ItemQuery) => {
    return Effect.gen(function* () {
      if (!(yield* open())) return false;
      const bankItem = yield* wait.untilSome(
        get(selector).pipe(
          Effect.map((item) =>
            item === null ? Option.none() : Option.some(item),
          ),
        ),
        { timeout: "5 seconds" },
      );
      if (bankItem === null) return false;
      const sent = yield* bridge
        .invoke("bank.withdraw", [toItemSelector(selector)], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false)));
      if (!sent) return false;
      return yield* wait.until(
        Effect.all([
          store.items.get("bank", bankItem.itemId),
          store.items.get("inventory", bankItem.itemId),
          store.items.get("house", bankItem.itemId),
        ]).pipe(
          Effect.map(
            ([bank, inventory, house]) =>
              bank === null && (inventory !== null || house !== null),
          ),
        ),
        { timeout: "5 seconds" },
      );
    });
  };

  const swap = (inventorySelector: ItemQuery, bankSelector: ItemQuery) => {
    return Effect.gen(function* () {
      const inventoryItem = yield* store.items.get(
        "inventory",
        inventorySelector,
      );
      const bankItem = yield* get(bankSelector);
      if (inventoryItem === null || bankItem === null || !(yield* open())) {
        return false;
      }
      const sent = yield* bridge
        .invoke(
          "bank.swap",
          [toItemSelector(inventorySelector), toItemSelector(bankSelector)],
          Schema.Boolean,
        )
        .pipe(Effect.map(Option.getOrElse(() => false)));
      if (!sent) return false;
      return yield* wait.until(
        Effect.all([
          store.items.get("bank", inventoryItem.itemId),
          store.items.get("inventory", bankItem.itemId),
          store.items.get("house", bankItem.itemId),
        ]).pipe(
          Effect.map(
            ([newBankItem, inventoryItem, houseItem]) =>
              newBankItem !== null &&
              (inventoryItem !== null || houseItem !== null),
          ),
        ),
        { timeout: "5 seconds" },
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
    open,
    swap,
    withdraw,
    withdrawBatch,
  };
};

export type Bank = ReturnType<typeof makeBank>;
