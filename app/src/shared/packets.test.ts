import { describe, expect, it } from "vitest";

import {
  PACKET_QUEUE_DEFAULT_DELAY_MS,
  PACKET_QUEUE_MAX_DELAY_MS,
  PACKET_QUEUE_MIN_DELAY_MS,
  clampPacketQueueDelay,
  normalizePacketQueuePayload,
  normalizePacketText,
} from "./packets";

describe("packets", () => {
  it("normalizes packet log text without changing other capture types", () => {
    expect(
      normalizePacketText("[Sending - STR]: %xt%zm%gar%-1%", "client"),
    ).toBe("%xt%zm%gar%-1%");
    expect(
      normalizePacketText("[Sending - STR]: %xt%zm%gar%-1%", "server"),
    ).toBe("[Sending - STR]: %xt%zm%gar%-1%");
  });

  it("clamps queue delays to a safe finite value", () => {
    expect(clampPacketQueueDelay(1)).toBe(PACKET_QUEUE_MIN_DELAY_MS);
    expect(clampPacketQueueDelay("125.6")).toBe(126);
    expect(clampPacketQueueDelay(100_000)).toBe(PACKET_QUEUE_MAX_DELAY_MS);
    expect(clampPacketQueueDelay("")).toBe(PACKET_QUEUE_DEFAULT_DELAY_MS);
  });

  it("rejects queues containing only empty packets", () => {
    expect(() =>
      normalizePacketQueuePayload({
        delayMs: 100,
        packets: ["", "  "],
        target: "server-string",
      }),
    ).toThrow("Packet queue is empty");
  });
});
