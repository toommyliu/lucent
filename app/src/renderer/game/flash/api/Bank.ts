import { Context, Effect, Layer } from "effect";

import type { ItemRecord, ItemSelector } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { normalizeItemRecord } from "../payload";
import { FlashProtocol } from "../protocol/FlashProtocol";
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
  readonly get: (selector: ItemSelector) => Effect.Effect<ItemRecord | null>;
  readonly getAll: Effect.Effect<readonly ItemRecord[]>;
  readonly getAvailableSlots: Effect.Effect<number>;
  readonly getSlots: Effect.Effect<number>;
  readonly getUsedSlots: Effect.Effect<number>;
  readonly isOpen: Effect.Effect<boolean>;
  readonly open: (force?: boolean) => Effect.Effect<void>;
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
    const protocol = yield* FlashProtocol;
    const wait = yield* WaitApi;

    const isOpen = bridge.call("bank.isOpen");

    const open: BankApiShape["open"] = (force = false) =>
      Effect.gen(function* () {
        if (!(yield* auth.isLoggedIn)) {
          return;
        }

        const currentlyOpen = yield* isOpen;
        if (currentlyOpen && !force) {
          return;
        }

        if (currentlyOpen && force) {
          yield* bridge.call("bank.open");
          yield* wait.until(isOpen.pipe(Effect.map((openNow) => !openNow)), {
            timeout: "3 seconds",
          });
        }

        yield* bridge.call("bank.open");
      });

    const getAll = bridge.call("bank.getItems").pipe(
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
        const item = normalizeItemRecord(raw, { banked: true });
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

    const settleBankPacket = (command: string) =>
      protocol
        .oncePacket({ command }, { timeout: "5 seconds" })
        .pipe(Effect.map((packet) => packet !== null));

    const deposit: BankApiShape["deposit"] = (selector) =>
      Effect.gen(function* () {
        const normalized = normalizeItemSelector(selector);
        if (
          normalized === null ||
          (yield* items.get("inventory-or-house", selector)) === null
        ) {
          return false;
        }

        yield* open();
        const sent = yield* bridge.call("bank.deposit", [normalized]);
        return sent && (yield* settleBankPacket("bankFromInv"));
      });

    const withdraw: BankApiShape["withdraw"] = (selector) =>
      Effect.gen(function* () {
        const normalized = normalizeItemSelector(selector);
        if (normalized === null || (yield* get(selector)) === null) {
          return false;
        }

        yield* open();
        const sent = yield* bridge.call("bank.withdraw", [normalized]);
        return sent && (yield* settleBankPacket("bankToInv"));
      });

    const swap: BankApiShape["swap"] = (inventorySelector, bankSelector) =>
      Effect.gen(function* () {
        const normalizedInventory = normalizeItemSelector(inventorySelector);
        const normalizedBank = normalizeItemSelector(bankSelector);
        if (
          normalizedInventory === null ||
          normalizedBank === null ||
          (yield* items.get("inventory-or-house", inventorySelector)) ===
            null ||
          (yield* get(bankSelector)) === null
        ) {
          return false;
        }

        yield* open();
        const sent = yield* bridge.call("bank.swap", [
          normalizedInventory,
          normalizedBank,
        ]);
        return sent && (yield* settleBankPacket("bankSwapInv"));
      });

    const getSlots = bridge.call("bank.getSlots");
    const getUsedSlots = bridge.call("bank.getUsedSlots");

    return BankApi.of({
      contains,
      deposit,
      depositBatch: (selectors) =>
        Effect.forEach(selectors, deposit, { concurrency: 1 }),
      get,
      getAll,
      getAvailableSlots: Effect.zipWith(getSlots, getUsedSlots, (slots, used) =>
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
