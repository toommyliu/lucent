import { describe, expect, it } from "vitest";

import {
  antiCounterDurationMsFromAura,
  antiCounterExpiresAtMs,
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

  it("normalizes aura durations and applies trigger expiry policy", () => {
    expect(antiCounterDurationMsFromAura(6)).toBe(6_000);
    expect(antiCounterDurationMsFromAura(0)).toBeUndefined();
    expect(antiCounterExpiresAtMs(1_000, 6_000)).toBe(7_750);
    expect(antiCounterExpiresAtMs(1_000, undefined)).toBe(8_750);
  });
});
