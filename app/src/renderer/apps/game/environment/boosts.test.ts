import { describe, expect, it } from "@effect/vitest";
import { LiveItem } from "@lucent/game";
import * as Effect from "effect/Effect";

import {
  discoverEnvironmentBoosts,
  withdrawEnvironmentBoosts,
  type EnvironmentBoostApi,
} from "./boosts";

const item = (
  itemId: number,
  name: string,
  context: "bank" | "inventory",
  category = "ServerUse",
) =>
  new LiveItem({
    category,
    coins: false,
    context,
    cost: 0,
    description: "",
    equipped: false,
    equipmentSlot: "",
    file: "",
    houseItem: false,
    itemId,
    link: "",
    memberOnly: false,
    meta: "",
    name,
    quantity: 1,
    temporaryItem: false,
  });

const makeApi = (options: {
  readonly bank: readonly LiveItem[];
  readonly inventory: readonly LiveItem[];
  readonly open?: Effect.Effect<boolean>;
  readonly withdraw?: (itemId: number) => Effect.Effect<boolean>;
}): EnvironmentBoostApi => ({
  bank: {
    get: (selector) =>
      Effect.succeed(
        typeof selector === "number"
          ? (options.bank.find((candidate) => candidate.itemId === selector) ??
              null)
          : null,
      ),
    getAll: () => Effect.succeed(options.bank),
    open: () => options.open ?? Effect.succeed(true),
    withdraw: (selector) =>
      options.withdraw?.(
        typeof selector === "number" ? selector : Number.NaN,
      ) ?? Effect.succeed(false),
  },
  inventory: {
    get: (selector) =>
      Effect.succeed(
        typeof selector === "number"
          ? (options.inventory.find(
              (candidate) => candidate.itemId === selector,
            ) ?? null)
          : null,
      ),
    getAll: () => Effect.succeed(options.inventory),
  },
});

describe("Environment boost discovery", () => {
  it.effect("filters and deduplicates inventory and bank boosts", () =>
    Effect.gen(function* () {
      const discovery = yield* discoverEnvironmentBoosts(
        makeApi({
          bank: [
            item(3, "Gold Boost", "bank"),
            item(4, " gold boost ", "bank"),
            item(5, "XP BOOST", "bank"),
            item(6, "Bank Sword", "bank", "Sword"),
          ],
          inventory: [
            item(1, "XP Boost", "inventory"),
            item(2, " xp boost ", "inventory"),
            item(7, "Inventory Sword", "inventory", "Sword"),
          ],
        }),
      );

      expect(discovery).toEqual({
        bank: [{ itemId: 3, name: "Gold Boost", quantity: 1 }],
        bankLoaded: true,
        inventory: ["XP Boost"],
      });
    }),
  );

  it.effect("preserves inventory results when the bank cannot load", () =>
    Effect.gen(function* () {
      const discovery = yield* discoverEnvironmentBoosts(
        makeApi({
          bank: [item(2, "Gold Boost", "bank")],
          inventory: [item(1, "XP Boost", "inventory")],
          open: Effect.die("open failed"),
        }),
      );

      expect(discovery).toEqual({
        bank: [],
        bankLoaded: false,
        inventory: ["XP Boost"],
      });
    }),
  );
});

describe("Environment boost withdrawal", () => {
  it.effect(
    "revalidates candidates, accepts inventory races, and continues after failures",
    () =>
      Effect.gen(function* () {
        const withdrawals: number[] = [];
        const api = makeApi({
          bank: [
            item(1, "Gold Boost", "bank"),
            item(2, "Sword", "bank", "Sword"),
            item(4, "Rep Boost", "bank"),
          ],
          inventory: [item(3, "XP Boost", "inventory")],
          withdraw: (itemId) =>
            Effect.sync(() => {
              withdrawals.push(itemId);
              return itemId === 1;
            }),
        });

        expect(yield* withdrawEnvironmentBoosts(api, [3, 2, 1, 4, 1])).toEqual([
          3, 1,
        ]);
        expect(withdrawals).toEqual([1, 4]);
      }),
  );
});
