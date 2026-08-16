import { describe, expect, it } from "vitest";

import type { AccountGameSessionReport } from "@lucent/core/accounts";
import { makeAccountSessionRegistry } from "./AccountSessions";

const report = (
  generation: number,
  revision: number,
  username = "Alice",
): AccountGameSessionReport => ({
  connection: { state: "online", username },
  login: { state: "idle" },
  rendererGeneration: generation,
  revision,
  script: { state: "idle" },
});

describe("account session registry", () => {
  it("registers a direct window before its renderer reports", () => {
    const registry = makeAccountSessionRegistry(() => 0);

    expect(registry.ensureDirect(10, 1, 20)).toBe(true);
    expect(registry.snapshot()).toEqual([
      {
        connection: { state: "offline" },
        gameWindowGroupId: 20,
        gameWindowId: 10,
        login: { state: "idle" },
        rendererGeneration: 1,
        revision: 0,
        script: { state: "idle" },
        updatedAt: 0,
      },
    ]);
  });

  it("accepts only newer reports from the current renderer generation", () => {
    let timestamp = 0;
    const registry = makeAccountSessionRegistry(() => ++timestamp);
    registry.trackLaunch(10, 3, 20, {
      account: { label: "Alice", password: "secret", username: "Alice" },
      requestedAt: 1,
    });

    expect(registry.acceptReport(10, report(3, 1), 20)).toBe(true);
    expect(registry.acceptReport(10, report(3, 1), 20)).toBe(false);
    expect(registry.acceptReport(10, report(2, 2), 20)).toBe(false);
    expect(registry.snapshot()[0]?.revision).toBe(1);
  });

  it("resets the revision barrier on reload and rejects the old generation", () => {
    const registry = makeAccountSessionRegistry(() => 0);
    registry.ensureDirect(10, 1, undefined);
    expect(registry.acceptReport(10, report(1, 8), undefined)).toBe(true);

    expect(registry.reload(10, 2)).toBe(true);
    expect(registry.acceptReport(10, report(1, 9), undefined)).toBe(false);
    expect(registry.acceptReport(10, report(2, 1, "Bob"), undefined)).toBe(
      true,
    );
    expect(registry.snapshot()[0]).toMatchObject({
      connection: { state: "online", username: "Bob" },
      rendererGeneration: 2,
      revision: 1,
    });
  });

  it("cannot recreate a closed session from a late report", () => {
    const registry = makeAccountSessionRegistry();
    registry.ensureDirect(10, 1, undefined);
    expect(registry.remove(10)).toBe(true);
    expect(registry.acceptReport(10, report(1, 1), undefined)).toBe(false);
    expect(registry.snapshot()).toEqual([]);
  });
});
