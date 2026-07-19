import { describe, expect, it } from "vitest";

import { matchesEvent, type Event, type EventSelector } from "./Event";

describe("matchesEvent", () => {
  it("matches only the selected event's scalar fields", () => {
    const event: Event = {
      name: "Focus",
      sourceId: 2,
      sourceType: "player",
      targetId: 7,
      targetType: "monster",
      type: "aura-added",
    };

    expect(matchesEvent(event, undefined)).toBe(true);
    expect(
      matchesEvent(event, {
        name: "Focus",
        targetId: 7,
        type: "aura-added",
      }),
    ).toBe(true);
    expect(
      matchesEvent(event, {
        name: "Vendetta",
        type: "aura-added",
      }),
    ).toBe(false);
    expect(
      matchesEvent(event, {
        monsterMapId: 7,
        type: "aura-added",
      } as unknown as EventSelector),
    ).toBe(false);
    expect(matchesEvent(event, null as unknown as EventSelector)).toBe(false);
  });
});
