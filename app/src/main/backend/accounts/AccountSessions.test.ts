import { describe, expect, it } from "@effect/vitest";
import {
  makeAccountSessions,
  mergeAccountSessionDisplayMetadata,
} from "./AccountSessions";

describe("AccountSessions", () => {
  it("stores script sessions by game window id", () => {
    const sessions = makeAccountSessions();

    sessions.upsertSession({
      gameWindowId: 7,
      launchUsername: "launch-user",
      currentUsername: "current-user",
      status: "running",
      scriptName: "farm.js",
      message: "Running farm.js",
      updatedAt: 1,
    });

    expect(sessions.getSession(7)).toMatchObject({
      gameWindowId: 7,
      launchUsername: "launch-user",
      currentUsername: "current-user",
      status: "running",
    });
  });

  it("keeps open windows independent from account rename and delete metadata", () => {
    const sessions = makeAccountSessions();

    sessions.upsertSession({
      gameWindowId: 7,
      launchUsername: "old-name",
      currentUsername: "current-name",
      status: "running",
      updatedAt: 1,
    });

    sessions.setGameLaunchPayload(7, {
      account: {
        label: "Old",
        username: "old-name",
        password: "secret",
      },
      gameWindowId: 7,
      requestedAt: 1,
    });

    expect(sessions.hasSession(7)).toBe(true);
    expect(sessions.getSession(7)?.launchUsername).toBe("old-name");
    expect(sessions.getGameLaunchPayload(7)?.account.username).toBe("old-name");
  });

  it("allows current username metadata to change without changing identity", () => {
    const sessions = makeAccountSessions();

    sessions.upsertSession({
      gameWindowId: 7,
      launchUsername: "launch-user",
      currentUsername: "first-user",
      status: "running",
      updatedAt: 1,
    });
    sessions.upsertSession({
      gameWindowId: 7,
      launchUsername: "launch-user",
      currentUsername: "second-user",
      status: "running",
      updatedAt: 2,
    });

    expect(sessions.getSessionsState()).toEqual([
      {
        gameWindowId: 7,
        launchUsername: "launch-user",
        currentUsername: "second-user",
        status: "running",
        updatedAt: 2,
      },
    ]);
  });

  it("allows current username metadata to be cleared on logout", () => {
    const sessions = makeAccountSessions();

    sessions.upsertSession({
      gameWindowId: 7,
      launchUsername: "launch-user",
      currentUsername: "first-user",
      status: "running",
      updatedAt: 1,
    });
    sessions.upsertSession({
      gameWindowId: 7,
      launchUsername: "launch-user",
      currentUsername: "",
      status: "running",
      updatedAt: 2,
    });

    expect(sessions.getSession(7)?.currentUsername).toBe("");
  });

  it("stores live game window identity independent from script sessions", () => {
    const sessions = makeAccountSessions();

    sessions.setGameWindowIdentity(7, {
      currentUsername: "first-user",
      updatedAt: 1,
    });
    sessions.setGameWindowIdentity(7, {
      currentUsername: "second-user",
      updatedAt: 2,
    });

    expect(sessions.getGameWindowIdentity(7)).toEqual({
      currentUsername: "second-user",
      updatedAt: 2,
    });

    sessions.deleteGameWindowIdentity(7);

    expect(sessions.getGameWindowIdentity(7)).toBeUndefined();
  });

  it("preserves display metadata when a status update omits usernames", () => {
    expect(
      mergeAccountSessionDisplayMetadata(
        {
          gameWindowId: 7,
          launchUsername: "launch-user",
          currentUsername: "current-user",
          status: "running",
          scriptName: "farm.js",
          message: "Running farm.js",
          updatedAt: 1,
        },
        {
          gameWindowId: 7,
          status: "idle",
          message: "No script loaded",
          updatedAt: 2,
        },
      ),
    ).toEqual({
      gameWindowId: 7,
      launchUsername: "launch-user",
      currentUsername: "current-user",
      status: "idle",
      message: "No script loaded",
      updatedAt: 2,
    });
  });
});
