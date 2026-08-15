import { describe, expect, it } from "vitest";

import {
  isValidGameViewGroupTargetSnapshot,
  resolveGameViewGroupTargets,
  type GameViewHostState,
} from "./gameViews";

const state: GameViewHostState = {
  capacity: 7,
  groupControlsOpen: true,
  groupTargetIds: ["alpha"],
  layout: "focused",
  selectedId: "alpha",
  sessions: [
    { id: "alpha", name: "Alpha", phase: "ready" },
    { id: "beta", name: "Beta", phase: "ready" },
    { id: "gamma", name: "Gamma", phase: "loading" },
  ],
};

describe("game view group target snapshots", () => {
  it("resolves the captured targets instead of the host's current selection", () => {
    expect(resolveGameViewGroupTargets(state, ["beta", "gamma"])).toEqual({
      readySessions: [state.sessions[1]],
      skippedCount: 1,
    });
  });

  it("rejects duplicate and foreign targets", () => {
    expect(isValidGameViewGroupTargetSnapshot(state, ["alpha", "beta"])).toBe(
      true,
    );
    expect(isValidGameViewGroupTargetSnapshot(state, ["alpha", "alpha"])).toBe(
      false,
    );
    expect(isValidGameViewGroupTargetSnapshot(state, ["other"])).toBe(false);
  });
});
