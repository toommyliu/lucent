import { describe, expect, it } from "vitest";

import type { AccountSessionReport } from "@lucent/core/accounts";
import { makeAccountSessionTracker } from "./accountSessionTracker";

const makeHarness = (start = true) => {
  const reports: AccountSessionReport[] = [];
  const tracker = makeAccountSessionTracker({
    onReportError: (error) => {
      throw error;
    },
    rendererGeneration: Promise.resolve(3),
    report: (report) => {
      reports.push(report);
      return Promise.resolve();
    },
  });
  if (start) tracker.start();
  return { reports, tracker };
};

describe("account session tracker", () => {
  it("publishes launch state as the first renderer snapshot", async () => {
    const { reports, tracker } = makeHarness(false);
    tracker.beginLaunch("Alice");

    tracker.start();
    await tracker.flush();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.runtime).toMatchObject({
      connection: { state: "offline" },
      login: { state: "waiting-for-game" },
    });
  });

  it("continues a serverless launch after manual server selection", async () => {
    const { reports, tracker } = makeHarness();
    const attempt = tracker.beginLaunch("Alice");
    tracker.setLogin(attempt, { state: "authenticating" });
    tracker.setLogin(attempt, { state: "waiting-for-server" });

    const identityEpoch = tracker.connectionStarted();

    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "connecting" },
      login: { state: "waiting-for-player" },
    });

    tracker.markOnline(identityEpoch, "Alice");
    await tracker.flush();

    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "online", username: "Alice" },
      login: { state: "idle" },
    });
    expect(reports.map((report) => report.revision)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("invalidates readiness reads that began before a launch", () => {
    const { tracker } = makeHarness();
    const previousEpoch = tracker.connectionStarted();
    tracker.markOnline(previousEpoch, "Alice");

    tracker.beginLaunch("Bob");

    expect(tracker.markOnline(previousEpoch, "Alice")).toBe(false);
    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "online", username: "Alice" },
      login: { state: "waiting-for-game" },
    });
  });

  it("rejects a ready-player result from a disconnected socket", () => {
    const { tracker } = makeHarness();
    const identityEpoch = tracker.connectionStarted();

    tracker.disconnected();

    expect(tracker.markOnline(identityEpoch, "Alice")).toBe(false);
    expect(tracker.getRuntime().connection).toEqual({ state: "offline" });
  });

  it("returns to server selection when a manual connection fails", () => {
    const { tracker } = makeHarness();
    const attempt = tracker.beginLaunch("Alice");
    tracker.setLogin(attempt, { state: "waiting-for-server" });
    tracker.connectionStarted();

    tracker.disconnected();

    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "offline" },
      login: { state: "waiting-for-server" },
    });
  });

  it("replaces identity after reconnecting as another account", () => {
    const { tracker } = makeHarness();
    const firstEpoch = tracker.connectionStarted();
    tracker.markOnline(firstEpoch, "Alice");

    tracker.disconnected();
    const secondEpoch = tracker.connectionStarted();
    tracker.markOnline(secondEpoch, "Bob");

    expect(tracker.markOnline(firstEpoch, "Alice")).toBe(false);
    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "online", username: "Bob" },
      login: { state: "idle" },
    });
  });

  it("accepts a repeated observation from the current connection", async () => {
    const { reports, tracker } = makeHarness();
    const identityEpoch = tracker.connectionStarted();
    tracker.markOnline(identityEpoch, "Alice");
    await tracker.flush();
    const reportCount = reports.length;

    expect(tracker.markOnline(identityEpoch, "Alice")).toBe(true);
    await tracker.flush();
    expect(reports).toHaveLength(reportCount);
  });

  it("invalidates async work across a reconnect to the same account", () => {
    const { tracker } = makeHarness();
    const firstEpoch = tracker.connectionStarted();
    tracker.markOnline(firstEpoch, "Alice");

    tracker.disconnected();
    const secondEpoch = tracker.connectionStarted();
    tracker.markOnline(secondEpoch, "Alice");

    expect(tracker.isOnlineAs(firstEpoch, "Alice")).toBe(false);
    expect(tracker.isOnlineAs(secondEpoch, "alice")).toBe(true);
  });

  it("reports the actual account when a launch reaches the wrong player", () => {
    const { tracker } = makeHarness();
    tracker.beginLaunch("Alice");
    const identityEpoch = tracker.connectionStarted();

    tracker.markOnline(identityEpoch, "Bob");

    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "online", username: "Bob" },
      login: {
        message: "Expected Alice, connected as Bob",
        state: "failed",
      },
    });
  });

  it("allows a later connection to satisfy a failed launch", () => {
    const { tracker } = makeHarness();
    const attempt = tracker.beginLaunch("Alice");
    tracker.failLaunch(attempt, "Login timed out");

    const identityEpoch = tracker.connectionStarted();
    tracker.markOnline(identityEpoch, "Alice");

    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "online", username: "Alice" },
      login: { state: "idle" },
    });
  });

  it("allows the expected account to replace a wrong-account failure", () => {
    const { tracker } = makeHarness();
    tracker.beginLaunch("Alice");
    const wrongEpoch = tracker.connectionStarted();
    tracker.markOnline(wrongEpoch, "Bob");

    tracker.disconnected();
    const correctEpoch = tracker.connectionStarted();
    tracker.markOnline(correctEpoch, "Alice");

    expect(tracker.getRuntime()).toMatchObject({
      connection: { state: "online", username: "Alice" },
      login: { state: "idle" },
    });
  });

  it("keeps the last actual script name when the runner stops", () => {
    const { tracker } = makeHarness();
    tracker.setScript({ name: "manual.js", state: "running" });

    tracker.setScript({ message: "Stopped by user", state: "stopped" });

    expect(tracker.getRuntime().script).toEqual({
      message: "Stopped by user",
      name: "manual.js",
      state: "stopped",
    });
  });

  it("publishes manual script preparation before the runner starts", async () => {
    const { reports, tracker } = makeHarness();

    tracker.setScript({
      message: "Waiting for script inputs",
      name: "manual.js",
      state: "starting",
    });
    await tracker.flush();

    expect(reports.at(-1)?.runtime.script).toEqual({
      message: "Waiting for script inputs",
      name: "manual.js",
      state: "starting",
    });
  });

  it("ignores status from a superseded launch", () => {
    const { tracker } = makeHarness();
    const firstAttempt = tracker.beginLaunch("Alice");
    const secondAttempt = tracker.beginLaunch("Bob");

    expect(tracker.failLaunch(firstAttempt, "old failure")).toBe(false);
    expect(tracker.setLogin(secondAttempt, { state: "authenticating" })).toBe(
      true,
    );
    expect(
      tracker.setLaunchScript(firstAttempt, {
        message: "old failure",
        state: "failed",
      }),
    ).toBe(false);
    expect(tracker.getRuntime().login).toEqual({ state: "authenticating" });
  });

  it("keeps a terminal failure from late lifecycle updates", () => {
    const { tracker } = makeHarness();
    const attempt = tracker.beginLaunch("Alice");

    tracker.failLaunch(attempt, "failed");

    expect(tracker.setLogin(attempt, { state: "authenticating" })).toBe(false);
    expect(tracker.getRuntime().login).toEqual({
      message: "failed",
      state: "failed",
    });
  });

  it("invalidates an in-flight launch when cancelled", () => {
    const { tracker } = makeHarness();
    const attempt = tracker.beginLaunch("Alice");

    tracker.cancelLaunch();

    expect(tracker.failLaunch(attempt, "late failure")).toBe(false);
    expect(tracker.getRuntime().login).toEqual({ state: "idle" });
  });
});
