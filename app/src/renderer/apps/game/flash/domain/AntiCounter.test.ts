import { describe, expect, it } from "@effect/vitest";

import {
  antiCounterDurationMsFromAura,
  matchAntiCounterAura,
  matchAntiCounterMessage,
} from "./AntiCounter";

describe("AntiCounter", () => {
  it("matches messages and auras through the trigger table", () => {
    expect(
      matchAntiCounterMessage("  Boss prepares   a counter attack!  "),
    ).toMatchObject({
      triggerId: "anti-counter",
    });
    expect(matchAntiCounterAura("Counter Attack")).toMatchObject({
      triggerId: "anti-counter",
    });
    expect(matchAntiCounterAura("Empowered Counter Attack")).toMatchObject({
      triggerId: "anti-counter",
    });
    expect(matchAntiCounterMessage("Boss prepares an attack")).toBeUndefined();
    expect(matchAntiCounterAura("Focus")).toBeUndefined();
  });

  it("normalizes aura durations", () => {
    expect(antiCounterDurationMsFromAura(6)).toBe(6_000);
    expect(antiCounterDurationMsFromAura(0)).toBeUndefined();
  });
});
