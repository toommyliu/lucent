import { describe, expect, it } from "@effect/vitest";
import type { AccountGameLaunchPayload } from "../../../shared/ipc";
import {
  createAccountManagerStatusPublisher,
  createGameWindowIdentityPublisher,
  toAccountGameWindowIdentityUpdate,
  toAccountScriptStatusUpdate,
} from "./accountManagerStatusBridge";

const launchPayload: AccountGameLaunchPayload = {
  account: {
    label: "Main",
    username: "main",
    password: "secret",
  },
  gameWindowId: 7,
  requestedAt: 1,
};

describe("account manager status bridge", () => {
  it("builds script status updates with current username metadata", () => {
    expect(
      toAccountScriptStatusUpdate(
        {
          status: "running",
          scriptName: "farm.js",
          message: "Running farm.js",
          updatedAt: 1,
        },
        " CurrentUser ",
      ),
    ).toEqual({
      status: "running",
      currentUsername: "CurrentUser",
      scriptName: "farm.js",
      message: "Running farm.js",
    });

    expect(
      toAccountScriptStatusUpdate(
        {
          status: "idle",
          message: "No script loaded",
          updatedAt: 1,
        },
        "",
      ),
    ).toEqual({
      status: "idle",
      currentUsername: "",
      message: "No script loaded",
    });
  });

  it("dedupes status updates but republishes when the username changes", async () => {
    let payload: AccountGameLaunchPayload | null = launchPayload;
    let username = "Alpha";
    const updates: unknown[] = [];
    const publisher = createAccountManagerStatusPublisher({
      getLaunchPayload: () => payload,
      getCurrentUsername: async () => username,
      publish: async (update) => {
        updates.push(update);
      },
    });

    const status = {
      status: "running" as const,
      scriptName: "farm.js",
      message: "Running farm.js",
      updatedAt: 1,
    };

    await publisher.publishStatus(status);
    await publisher.publishStatus({ ...status, updatedAt: 2 });
    username = "Beta";
    await publisher.publishStatus({ ...status, updatedAt: 3 });
    payload = null;
    await publisher.publishStatus({ ...status, updatedAt: 4 });

    expect(updates).toEqual([
      {
        status: "running",
        currentUsername: "Alpha",
        scriptName: "farm.js",
        message: "Running farm.js",
      },
      {
        status: "running",
        currentUsername: "Beta",
        scriptName: "farm.js",
        message: "Running farm.js",
      },
    ]);
  });

  it("publishes live game window identity after login and clears after logout", async () => {
    let username = "";
    const updates: unknown[] = [];
    const publisher = createGameWindowIdentityPublisher({
      getCurrentUsername: async () => username,
      publish: async (update) => {
        updates.push(update);
      },
    });

    expect(toAccountGameWindowIdentityUpdate(" Hero ")).toEqual({
      currentUsername: "Hero",
    });

    await publisher.publishIdentity();
    username = "Hero";
    await publisher.publishIdentity();
    await publisher.publishIdentity();
    username = "";
    await publisher.publishIdentity();

    expect(updates).toEqual([
      { currentUsername: "Hero" },
      { currentUsername: "" },
    ]);
  });
});
