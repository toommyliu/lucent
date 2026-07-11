import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { WireInt } from "../contract/Coercion";
import { ItemPayload, ItemPayloads, toItem } from "../contract/payload/Items";
import { decodeItemSelector, quantity } from "../domain/Selectors";
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
  const get = (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(null);
    return store.items.get("bank", decoded.value).pipe(
      Effect.flatMap((cached) =>
        cached !== null
          ? Effect.succeed(cached)
          : bridge.invoke("bank.getItem", [decoded.value], NullableItem).pipe(
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

  const contains = (selector: unknown, requested?: number) =>
    get(selector).pipe(
      Effect.map(
        (item) => item !== null && item.quantity >= quantity(requested),
      ),
    );

  const deposit = (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(false);
    return Effect.gen(function* () {
      const inventoryItem = yield* store.items.get("inventory", decoded.value);
      if (inventoryItem === null || !(yield* open())) return false;
      const sent = yield* bridge
        .invoke("bank.deposit", [decoded.value], Schema.Boolean)
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

  const withdraw = (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (!(yield* open())) return false;
      const bankItem = yield* wait.untilSome(
        get(decoded.value).pipe(
          Effect.map((item) =>
            item === null ? Option.none() : Option.some(item),
          ),
        ),
        { timeout: "5 seconds" },
      );
      if (bankItem === null) return false;
      const sent = yield* bridge
        .invoke("bank.withdraw", [decoded.value], Schema.Boolean)
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

  const swap = (inventorySelector: unknown, bankSelector: unknown) => {
    const inventory = decodeItemSelector(inventorySelector);
    const bank = decodeItemSelector(bankSelector);
    if (Option.isNone(inventory) || Option.isNone(bank)) {
      return Effect.succeed(false);
    }
    return Effect.gen(function* () {
      const inventoryItem = yield* store.items.get(
        "inventory",
        inventory.value,
      );
      const bankItem = yield* get(bank.value);
      if (inventoryItem === null || bankItem === null || !(yield* open())) {
        return false;
      }
      const sent = yield* bridge
        .invoke("bank.swap", [inventory.value, bank.value], Schema.Boolean)
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

  const depositBatch = (selectors: readonly unknown[]) =>
    Effect.forEach(selectors, deposit, { concurrency: 1 });

  const withdrawBatch = (selectors: readonly unknown[]) =>
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
