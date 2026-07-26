import { describe, expect, it } from "vitest";

import { statusFromStartingCancellation } from "./ScriptRunner";

describe("ScriptRunner", () => {
  it("returns a disconnected restart attempt to waiting after cancellation", () => {
    const status = statusFromStartingCancellation(
      {
        restart: {
          disconnectedAt: "2026-07-26T12:00:00.000Z",
          name: "Reconnect repro",
          path: "/scripts/reconnect-repro.js",
        },
      },
      {
        reason: "connection lost",
        retryAfterReconnect: true,
      },
    );

    expect(status).toEqual({
      disconnectedAt: "2026-07-26T12:00:00.000Z",
      name: "Reconnect repro",
      path: "/scripts/reconnect-repro.js",
      state: "waiting-to-restart",
    });
  });

  it("stops an ordinary cancelled start", () => {
    expect(
      statusFromStartingCancellation({}, { reason: "connection lost" }),
    ).toMatchObject({
      reason: "connection lost",
      state: "stopped",
    });
  });
});
