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
      yield* bridge.invoke("bank.open", undefined, Schema.Void);
      return yield* wait.until(isOpen(), { timeout: "3 seconds" });
    });
  const transfer = (
    method: "bank.deposit" | "bank.withdraw",
    selector: unknown,
  ) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(false);
    return open().pipe(
      Effect.flatMap((ready) =>
        ready
          ? bridge.invoke(method, [decoded.value], Schema.Boolean)
          : Effect.succeed(Option.none()),
      ),
      Effect.map(Option.getOrElse(() => false)),
    );
  };

  return {
    contains: (selector: unknown, requested?: number) =>
      get(selector).pipe(
        Effect.map(
          (item) => item !== null && item.quantity >= quantity(requested),
        ),
      ),
    deposit: (selector: unknown) => transfer("bank.deposit", selector),
    depositBatch: (selectors: readonly unknown[]) =>
      Effect.forEach(selectors, (selector) =>
        transfer("bank.deposit", selector),
      ),
    get,
    getAll,
    getAvailableSlots: () =>
      Effect.zipWith(getSlots(), getUsedSlots(), (slots, used) =>
        Math.max(0, slots - used),
      ),
    getSlots,
    getUsedSlots,
    isOpen,
    open,
    swap: (inventorySelector: unknown, bankSelector: unknown) => {
      const inventory = decodeItemSelector(inventorySelector);
      const bank = decodeItemSelector(bankSelector);
      return Option.isNone(inventory) || Option.isNone(bank)
        ? Effect.succeed(false)
        : bridge
            .invoke("bank.swap", [inventory.value, bank.value], Schema.Boolean)
            .pipe(Effect.map(Option.getOrElse(() => false)));
    },
    withdraw: (selector: unknown) => transfer("bank.withdraw", selector),
    withdrawBatch: (selectors: readonly unknown[]) =>
      Effect.forEach(selectors, (selector) =>
        transfer("bank.withdraw", selector),
      ),
  };
};

export type Bank = ReturnType<typeof makeBank>;
