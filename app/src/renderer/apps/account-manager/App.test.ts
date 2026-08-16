import { describe, expect, it } from "vitest";

import type { AccountGameSession } from "@lucent/core/accounts";
import { reconcileSessions } from "./sessionStateReconciliation";

const session = (
  rendererGeneration: number,
  revision: number,
): AccountGameSession => ({
  connection: { state: "offline" },
  gameWindowId: 1,
  login: { state: "idle" },
  rendererGeneration,
  revision,
  script: { state: "idle" },
  updatedAt: revision,
});

describe("account manager session reconciliation", () => {
  it("accepts a new renderer generation even when its revision resets", () => {
    const previous = session(1, 42);
    const reloaded = session(2, 0);

    expect(reconcileSessions([previous], [reloaded])).toEqual([reloaded]);
  });

  it("keeps an older revision within the same generation", () => {
    const previous = session(1, 42);

    expect(reconcileSessions([previous], [session(1, 41)])).toEqual([previous]);
  });

  it("keeps a newer revision even when the visible presentation is unchanged", () => {
    const next = session(1, 43);

    expect(reconcileSessions([session(1, 42)], [next])).toEqual([next]);
  });

  it("keeps a late report from an older renderer generation", () => {
    const current = session(2, 0);

    expect(reconcileSessions([current], [session(1, 99)])).toEqual([current]);
  });
});
