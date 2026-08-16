import { describe, expect, it } from "vitest";

import {
  initialAccountSessionTrackerState,
  makeAccountSessionTracker,
  reduceAccountSessionTracker,
} from "./accountSessionTracker";

describe("account session tracker", () => {
  it("ignores a readiness result from an earlier connection epoch", () => {
    const initial = initialAccountSessionTrackerState();
    const connecting = reduceAccountSessionTracker(initial, {
      type: "connection-start",
    });
    const disconnected = reduceAccountSessionTracker(connecting, {
      type: "connection-lost",
    });

    const stale = reduceAccountSessionTracker(disconnected, {
      type: "ready",
      token: { connectionEpoch: 1, launchAttempt: 0 },
      username: "Alice",
    });
    expect(stale).toEqual(disconnected);
  });

  it("ignores script completion after a newer launch attempt", () => {
    const tracker = makeAccountSessionTracker();
    const first = tracker.beginLaunch();
    tracker.disconnect();
    const second = tracker.beginLaunch();
    expect(second.launchAttempt).toBeGreaterThan(first.launchAttempt);

    const beforeStaleCompletion = tracker.state().script;
    expect(tracker.setScript({ state: "running", name: "old.js" }, first)).toBe(
      false,
    );
    expect(tracker.state().script).toEqual(beforeStaleCompletion);
  });

  it("keeps a reconnect retry in the same launch attempt", () => {
    const tracker = makeAccountSessionTracker();
    const launch = tracker.beginLaunch();

    tracker.disconnect();

    expect(tracker.isLaunchCurrent(launch.launchAttempt)).toBe(true);
    expect(tracker.isTokenCurrent(launch)).toBe(false);
  });

  it("keeps server selection offline even when launch credentials exist", () => {
    const tracker = makeAccountSessionTracker();
    const launch = tracker.beginLaunch();
    const { launchAttempt } = launch;
    tracker.setLogin({ state: "select-server" }, launchAttempt);
    expect(tracker.state()).toMatchObject({
      connection: { state: "offline" },
      login: { state: "select-server" },
    });
    expect(tracker.setReady("Alice", launch)).toBe(false);
  });

  it("keeps the observed connection while a new launch is only intent", () => {
    const tracker = makeAccountSessionTracker();
    const first = tracker.beginLaunch();
    expect(tracker.setReady("Alice", first)).toBe(true);
    const beforeLaunch = tracker.state();

    const second = tracker.beginLaunch();

    expect(second.connectionEpoch).toBe(beforeLaunch.connectionEpoch);
    expect(tracker.snapshot().connection).toEqual({
      state: "online",
      username: "Alice",
    });
    expect(tracker.snapshot().login).toEqual({ state: "waiting-for-game" });
  });

  it("clears logout script history across reconnect", () => {
    const tracker = makeAccountSessionTracker();
    const launch = tracker.beginLaunch();
    expect(tracker.setReady("Alice", launch)).toBe(true);

    tracker.disconnect();
    const reconnect = tracker.beginConnection();
    expect(tracker.state().script).toEqual({ state: "idle" });

    expect(tracker.setReady("Bob", reconnect)).toBe(true);
    expect(tracker.snapshot().connection).toEqual({
      state: "online",
      username: "Bob",
    });
    expect(tracker.snapshot().script).toEqual({ state: "idle" });
  });

  it("keeps the running script name when disconnecting", () => {
    const tracker = makeAccountSessionTracker();
    const token = tracker.beginLaunch();
    expect(
      tracker.setScript({ name: "farm.js", state: "running" }, token),
    ).toBe(true);

    tracker.disconnect();

    expect(tracker.snapshot().script).toEqual({
      name: "farm.js",
      reason: "Logged out",
      state: "stopped",
    });
  });

  it("cancels the launch on explicit logout", () => {
    const tracker = makeAccountSessionTracker();
    const launch = tracker.beginLaunch();
    expect(tracker.setReady("Alice", launch)).toBe(true);

    const cancelled = tracker.cancelLaunch();

    expect(cancelled.launchAttempt).toBeGreaterThan(launch.launchAttempt);
    expect(tracker.state().login).toEqual({ state: "idle" });
    expect(tracker.state().connection).toEqual({
      state: "online",
      username: "Alice",
    });
  });
});
