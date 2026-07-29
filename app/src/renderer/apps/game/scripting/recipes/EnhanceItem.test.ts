import { describe, expect, it } from "@effect/vitest";
import { LiveItem } from "@lucent/game";
import type { Enhancement, Item } from "@lucent/game";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { Packet } from "../../flash/contract/Packet";
import type { ScriptRecipeDependencies } from "./Dependencies";
import { enhanceItem } from "./EnhanceItem";

const weapon = (enhancement?: Enhancement) =>
  new LiveItem({
    category: "Sword",
    coins: false,
    context: "inventory",
    cost: 0,
    description: "",
    ...(enhancement === undefined ? {} : { enhancement }),
    equipped: false,
    equipmentSlot: "Weapon",
    file: "",
    houseItem: false,
    itemId: 100,
    link: "",
    memberOnly: false,
    meta: "",
    name: "Test Weapon",
    quantity: 1,
    temporaryItem: false,
  });

const candidate = (level: number, itemId: number) =>
  new LiveItem({
    category: "Enhancement",
    coins: false,
    context: "shop",
    cost: level * 100,
    description: "",
    enhancement: { level, patternId: 2, procId: 14 },
    equipped: false,
    equipmentSlot: "Weapon",
    file: "",
    houseItem: false,
    itemId,
    link: "",
    memberOnly: false,
    meta: "",
    name: `Dauntless ${level}`,
    quantity: 1,
    shopItemId: itemId * 10,
    temporaryItem: false,
  });

const selectorId = (selector: unknown): number =>
  typeof selector === "number"
    ? selector
    : ((selector as { readonly itemId?: number; readonly shopItemId?: number })
        .shopItemId ?? (selector as { readonly itemId: number }).itemId);

const makeDependencies = (options: {
  readonly candidates: readonly Item[];
  readonly current?: LiveItem;
  readonly level?: number;
  readonly purchasable: ReadonlySet<number>;
}) => {
  let current = options.current ?? weapon();
  const calls = {
    actions: [] as string[],
    bridgeMethods: [] as string[],
    candidateSelectors: [] as number[],
    invocations: 0,
    inventorySelectors: [] as unknown[],
    joins: [] as string[],
    loads: [] as number[],
    selectedItemId: 0,
  };

  const dependencies = {
    bridge: {
      invoke: (method: unknown, args: unknown) =>
        Effect.sync(() => {
          calls.invocations += 1;
          calls.bridgeMethods.push(String(method));
          const [selector] = args as readonly [unknown, number];
          const selected = options.candidates.find((entry) => {
            if (typeof selector === "number") return entry.itemId === selector;
            const query = selector as {
              readonly itemId?: number;
              readonly shopItemId?: number;
            };
            return query.shopItemId === undefined
              ? entry.itemId === query.itemId
              : entry.shopItemId === query.shopItemId;
          });
          calls.selectedItemId = selected?.itemId ?? 0;
          current = weapon(selected?.enhancement);
          return Option.some(selected !== undefined);
        }),
    },
    inventory: {
      get: (selector: unknown) =>
        Effect.sync(() => {
          calls.inventorySelectors.push(selector);
          return current;
        }),
    },
    player: {
      getLevel: () => Effect.succeed(options.level ?? 32),
      isMember: () => Effect.succeed(false),
      joinMap: (map: string) =>
        Effect.sync(() => {
          calls.joins.push(map);
          return true;
        }),
    },
    shops: {
      canBuy: (selector: unknown) =>
        Effect.sync(() => {
          const id = selectorId(selector);
          calls.candidateSelectors.push(id);
          return options.purchasable.has(id);
        }),
      getAll: () => Effect.succeed(options.candidates),
      load: (shopId: number) =>
        Effect.sync(() => {
          calls.loads.push(shopId);
          return true;
        }),
    },
    wait: {
      forGameAction: (action: string) =>
        Effect.sync(() => {
          calls.actions.push(action);
          return true;
        }),
      forPacket: (
        _selector: unknown,
        waitOptions: { readonly trigger: Effect.Effect<boolean> },
      ) =>
        Effect.gen(function* () {
          if (!(yield* waitOptions.trigger)) return null;
          return {} as Packet;
        }),
    },
  } as unknown as ScriptRecipeDependencies;

  return { calls, dependencies };
};

describe("enhanceItem", () => {
  it.effect("selects the highest matching level the player can use", () =>
    Effect.gen(function* () {
      const candidates = [
        candidate(34, 34),
        candidate(26, 26),
        candidate(30, 30),
      ];
      const { calls, dependencies } = makeDependencies({
        candidates,
        purchasable: new Set([260, 300, 340]),
      });

      expect(
        yield* enhanceItem(
          dependencies,
          { itemId: 100 },
          {
            enhancement: "forge",
            special: "dauntless",
          },
        ),
      ).toBe(true);
      expect(calls.candidateSelectors).toEqual([300]);
      expect(calls.selectedItemId).toBe(30);
      expect(calls.bridgeMethods).toEqual(["shops.enhance"]);
      expect(calls.inventorySelectors[0]).toEqual({ itemId: 100 });
      expect(calls.joins).toEqual(["forge"]);
      expect(calls.loads).toEqual([2_142]);
      expect(calls.actions).toEqual(["buyItem"]);
    }),
  );

  it.effect(
    "falls back to the next level when the closest row is unavailable",
    () =>
      Effect.gen(function* () {
        const candidates = [candidate(26, 26), candidate(30, 30)];
        const { calls, dependencies } = makeDependencies({
          candidates,
          purchasable: new Set([260]),
        });

        const result = yield* enhanceItem(dependencies, "Test Weapon", {
          enhancement: "fighter",
          special: "dauntless",
        });
        expect(calls.candidateSelectors).toEqual([300, 260]);
        expect(calls.selectedItemId).toBe(26);
        expect(result).toBe(true);
      }),
  );

  it.effect("does not repurchase the best available enhancement level", () =>
    Effect.gen(function* () {
      const candidates = [candidate(30, 30)];
      const { calls, dependencies } = makeDependencies({
        candidates,
        current: weapon({ level: 30, patternId: 2, procId: 14 }),
        purchasable: new Set(),
      });

      expect(
        yield* enhanceItem(dependencies, "Test Weapon", {
          enhancement: "forge",
          special: "dauntless",
        }),
      ).toBe(true);
      expect(calls.candidateSelectors).toEqual([]);
      expect(calls.invocations).toBe(0);
    }),
  );

  it.effect(
    "upgrades an existing enhancement when a higher level is usable",
    () =>
      Effect.gen(function* () {
        const candidates = [candidate(26, 26), candidate(30, 30)];
        const { calls, dependencies } = makeDependencies({
          candidates,
          current: weapon({ level: 26, patternId: 2, procId: 14 }),
          purchasable: new Set([300]),
        });

        expect(
          yield* enhanceItem(dependencies, "Test Weapon", {
            enhancement: "forge",
            special: "dauntless",
          }),
        ).toBe(true);
        expect(calls.candidateSelectors).toEqual([300]);
        expect(calls.selectedItemId).toBe(30);
        expect(calls.invocations).toBe(1);
      }),
  );

  it.effect("does not downgrade an existing matching enhancement", () =>
    Effect.gen(function* () {
      const candidates = [candidate(26, 26)];
      const { calls, dependencies } = makeDependencies({
        candidates,
        current: weapon({ level: 30, patternId: 2, procId: 14 }),
        purchasable: new Set([260]),
      });

      expect(
        yield* enhanceItem(dependencies, "Test Weapon", {
          enhancement: "forge",
          special: "dauntless",
        }),
      ).toBe(true);
      expect(calls.candidateSelectors).toEqual([]);
      expect(calls.invocations).toBe(0);
    }),
  );
});
