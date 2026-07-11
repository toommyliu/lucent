import { Context, Effect, Layer } from "effect";

import type { Item, ItemSelector } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { decodeItem, optionFromNullable } from "../payload";
import { normalizeItemSelector, normalizeQuantity } from "../selectors";
import { ItemsState } from "../state/Items";
import { AuthApi } from "./Auth";
import { WaitApi } from "./Wait";

export interface BankApiShape {
  readonly contains: (
    selector: ItemSelector,
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly deposit: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly depositBatch: (
    selectors: readonly ItemSelector[],
  ) => Effect.Effect<readonly boolean[]>;
  readonly get: (selector: ItemSelector) => Effect.Effect<Item | null>;
  readonly getAll: () => Effect.Effect<readonly Item[]>;
  readonly getAvailableSlots: () => Effect.Effect<number>;
  readonly getSlots: () => Effect.Effect<number>;
  readonly getUsedSlots: () => Effect.Effect<number>;
  readonly isOpen: () => Effect.Effect<boolean>;
  readonly open: (force?: boolean) => Effect.Effect<boolean>;
  readonly swap: (
    inventorySelector: ItemSelector,
    bankSelector: ItemSelector,
  ) => Effect.Effect<boolean>;
  readonly withdraw: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly withdrawBatch: (
    selectors: readonly ItemSelector[],
  ) => Effect.Effect<readonly boolean[]>;
}

export class BankApi extends Context.Service<BankApi, BankApiShape>()(
  "lucent/game/flash/api/Bank",
) {}

export const layer = Layer.effect(
  BankApi,
  Effect.gen(function* () {
    const auth = yield* AuthApi;
    const bridge = yield* SwfBridge;
    const items = yield* ItemsState;
    const wait = yield* WaitApi;

    const isOpen = () => bridge.call("bank.isOpen");

    const open: BankApiShape["open"] = (force = false) =>
      Effect.gen(function* () {
        if (!(yield* auth.isLoggedIn())) {
          return false;
        }

        const currentlyOpen = yield* isOpen();
        if (currentlyOpen && !force) {
          return true;
        }

        if (currentlyOpen && force) {
          yield* bridge.call("bank.open");
          const closed = yield* wait.until(
            isOpen().pipe(Effect.map((openNow) => !openNow)),
            { timeout: "3 seconds" },
          );
          if (!closed) {
            return false;
          }
        }

        yield* bridge.call("bank.open");
        return yield* wait.until(isOpen(), { timeout: "3 seconds" });
      });

    const getAll = () =>
      bridge.call("bank.getItems").pipe(
        Effect.flatMap((rawItems) =>
          Array.isArray(rawItems)
            ? items.replaceBank(rawItems)
            : items.replaceBank([]),
        ),
        Effect.flatMap(() => items.getAll("bank")),
      );

    const get: BankApiShape["get"] = (selector) =>
      Effect.gen(function* () {
        const cached = yield* items.get("bank", selector);
        if (cached !== null) {
          return cached;
        }

        const normalized = normalizeItemSelector(selector);
        if (normalized === null) {
          return null;
        }

        const raw = yield* bridge.call("bank.getItem", [normalized]);
        const item = decodeItem(raw, { context: "bank" });
        if (item !== null) {
          yield* items.upsert("bank", item);
        }
        return item;
      });

    const contains: BankApiShape["contains"] = (selector, quantity) =>
      Effect.gen(function* () {
        const cached = yield* get(selector);
        const needed = normalizeQuantity(quantity);
        if (cached !== null) {
          return cached.quantity >= needed;
        }

        const normalized = normalizeItemSelector(selector);
        if (normalized === null) {
          return false;
        }

        return quantity === undefined
          ? yield* bridge.call("bank.contains", [normalized])
          : yield* bridge.call("bank.contains", [normalized, needed]);
      });

    const deposit: BankApiShape["deposit"] = (selector) =>
      Effect.gen(function* () {
        const normalized = normalizeItemSelector(selector);
        const inventoryItem = yield* items.get("inventory", selector);
        if (normalized === null || inventoryItem === null) {
          return false;
        }

        if (!(yield* open())) {
          return false;
        }
        const sent = yield* bridge.call("bank.deposit", [normalized]);
        if (!sent) {
          return false;
        }

        return yield* wait.until(
          Effect.gen(function* () {
            const inventory = yield* items.get("inventory", {
              itemId: inventoryItem.itemId,
            });
            const bank = yield* items.get("bank", {
              itemId: inventoryItem.itemId,
            });
            return inventory === null && bank !== null;
          }),
          { timeout: "5 seconds" },
        );
      });

    const withdraw: BankApiShape["withdraw"] = (selector) =>
      Effect.gen(function* () {
        const normalized = normalizeItemSelector(selector);
        if (normalized === null) {
          return false;
        }

        if (!(yield* open())) {
          return false;
        }
        const bankItem = yield* wait.untilSome(
          get(selector).pipe(Effect.map(optionFromNullable)),
          { timeout: "5 seconds" },
        );
        if (bankItem === null) {
          return false;
        }
        const sent = yield* bridge.call("bank.withdraw", [normalized]);
        if (!sent) {
          return false;
        }

        return yield* wait.until(
          Effect.gen(function* () {
            const bank = yield* items.get("bank", {
              itemId: bankItem.itemId,
            });
            const inventory = yield* items.get("inventory-or-house", {
              itemId: bankItem.itemId,
            });
            return bank === null && inventory !== null;
          }),
          { timeout: "5 seconds" },
        );
      });

    const swap: BankApiShape["swap"] = (inventorySelector, bankSelector) =>
      Effect.gen(function* () {
        const normalizedInventory = normalizeItemSelector(inventorySelector);
        const normalizedBank = normalizeItemSelector(bankSelector);
        const inventoryItem = yield* items.get("inventory", inventorySelector);
        if (
          normalizedInventory === null ||
          normalizedBank === null ||
          inventoryItem === null
        ) {
          return false;
        }

        if (!(yield* open())) {
          return false;
        }
        const bankItem = yield* wait.untilSome(
          get(bankSelector).pipe(Effect.map(optionFromNullable)),
          { timeout: "5 seconds" },
        );
        if (bankItem === null) {
          return false;
        }
        const sent = yield* bridge.call("bank.swap", [
          normalizedInventory,
          normalizedBank,
        ]);
        if (!sent) {
          return false;
        }

        return yield* wait.until(
          Effect.gen(function* () {
            const [newBankItem, newInventoryItem] = yield* Effect.all([
              items.get("bank", { itemId: inventoryItem.itemId }),
              items.get("inventory-or-house", { itemId: bankItem.itemId }),
            ]);
            return newBankItem !== null && newInventoryItem !== null;
          }),
          { timeout: "5 seconds" },
        );
      });

    const getSlots = () => bridge.call("bank.getSlots");
    const getUsedSlots = () => bridge.call("bank.getUsedSlots");

    return BankApi.of({
      contains,
      deposit,
      depositBatch: (selectors) =>
        Effect.forEach(selectors, deposit, { concurrency: 1 }),
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
      swap,
      withdraw,
      withdrawBatch: (selectors) =>
        Effect.forEach(selectors, withdraw, { concurrency: 1 }),
    });
  }),
);
