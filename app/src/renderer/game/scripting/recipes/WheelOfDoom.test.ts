import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { Packet } from "../../flash/contract/Packet";
import type { ScriptRecipeDependencies } from "./Dependencies";
import { doWheelOfDoom } from "./WheelOfDoom";

const DAILY_XP_BOOST = "Daily XP Boost! (1 hr)";
const OPTIONAL_REWARD = "Nobles Mace";

const wheelPacket = (includeOptionalReward: boolean): Packet => ({
  command: "Wheel",
  data: {
    dropItems: {
      "18927": { sName: "Treasure Potion" },
      "19189": { sName: DAILY_XP_BOOST },
    },
    ...(includeOptionalReward ? { Item: { sName: OPTIONAL_REWARD } } : {}),
  },
  direction: "extension",
  raw: "",
  wireType: "json",
});

const makeDependencies = (packet: Packet) => {
  const deposited: string[] = [];
  const inventory = new Set([DAILY_XP_BOOST, OPTIONAL_REWARD]);
  const dependencies = {
    bank: {
      contains: () => Effect.succeed(false),
      depositBatch: (items: readonly string[]) =>
        Effect.sync(() => {
          deposited.push(...items);
          return items.map(() => true);
        }),
      withdraw: () => Effect.succeed(true),
    },
    inventory: {
      contains: () => Effect.succeed(true),
      get: (item: string) =>
        Effect.succeed(inventory.has(item) ? ({} as never) : null),
    },
    player: { joinMap: () => Effect.succeed(true) },
    quests: {
      accept: () => Effect.succeed(true),
      canComplete: () => Effect.succeed(true),
      complete: () => Effect.succeed(true),
    },
    wait: {
      forPacket: (
        _selector: unknown,
        options: { readonly trigger: Effect.Effect<boolean> },
      ) => options.trigger.pipe(Effect.as(packet)),
    },
  } as unknown as ScriptRecipeDependencies;

  return { dependencies, deposited };
};

describe("doWheelOfDoom", () => {
  it.effect("banks the XP boost and optional wheel reward", () =>
    Effect.gen(function* () {
      const { dependencies, deposited } = makeDependencies(wheelPacket(true));

      expect(yield* doWheelOfDoom(dependencies, true)).toBe(true);
      expect(deposited).toEqual([DAILY_XP_BOOST, OPTIONAL_REWARD]);
    }),
  );

  it.effect("banks the XP boost when no optional reward is awarded", () =>
    Effect.gen(function* () {
      const { dependencies, deposited } = makeDependencies(wheelPacket(false));

      expect(yield* doWheelOfDoom(dependencies, true)).toBe(true);
      expect(deposited).toEqual([DAILY_XP_BOOST]);
    }),
  );
});
