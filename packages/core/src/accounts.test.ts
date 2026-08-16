import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AccountLaunchRequestSchema,
  presentAccountGameSession,
  normalizeAccountManagerStorage,
  renameGroupMemberUsername,
  removeGroupMemberUsername,
  serializeAccountManagerStorage,
} from "./accounts";

const isAccountLaunchRequest = Schema.is(AccountLaunchRequestSchema);

describe("account manager storage", () => {
  it("normalizes existing account JSON while preserving the saved shape", () => {
    const normalized = normalizeAccountManagerStorage({
      accounts: [
        { label: "Main", username: "Hero", password: "secret" },
        { label: "Duplicate", username: "hero", password: "ignored" },
        { label: "Alt", username: "Alt", password: "alt-secret" },
        { label: "Broken", username: "NoPassword" },
      ],
      groups: {
        Farmers: ["Hero", "Alt", "Missing", "Hero"],
        " ": ["Hero"],
      },
    });

    expect(normalized).toEqual({
      accounts: [
        { label: "Main", username: "Hero", password: "secret" },
        { label: "Alt", username: "Alt", password: "alt-secret" },
      ],
      groups: {
        Farmers: ["Hero", "Alt"],
      },
    });

    expect(serializeAccountManagerStorage(normalized)).toEqual(normalized);
  });

  it("keeps group membership aligned with account renames and deletes", () => {
    const groups = {
      Farmers: ["Hero", "Alt"],
      Solo: ["Hero"],
    };

    expect(renameGroupMemberUsername(groups, "Hero", "Main")).toEqual({
      Farmers: ["Main", "Alt"],
      Solo: ["Main"],
    });
    expect(removeGroupMemberUsername(groups, "Hero")).toEqual({
      Farmers: ["Alt"],
      Solo: [],
    });
  });
});

describe("account launch request", () => {
  it("accepts path-only script references", () => {
    expect(
      isAccountLaunchRequest({
        username: "Hero",
        script: { name: "farm.js", path: "/scripts/farm.js" },
      }),
    ).toBe(true);
    expect(
      isAccountLaunchRequest({
        username: "Hero",
        script: { name: "farm.js" },
      }),
    ).toBe(false);
  });

  it("accepts only complete, valid tiling placements", () => {
    expect(
      isAccountLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "horizontal", count: 2, index: 1 },
      }),
    ).toBe(true);
    expect(
      isAccountLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "none", count: 2, index: 0 },
      }),
    ).toBe(false);
    expect(
      isAccountLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "horizontal", count: 1, index: 0 },
      }),
    ).toBe(false);
    expect(
      isAccountLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "horizontal", count: 2, index: 2 },
      }),
    ).toBe(false);
    expect(
      isAccountLaunchRequest({
        username: "Hero",
        tiling: { algorithm: "horizontal", count: 2.5, index: 0 },
      }),
    ).toBe(false);
  });
});

describe("account session presentation", () => {
  it("keeps a launch without a server offline", () => {
    expect(
      presentAccountGameSession({
        connection: { state: "offline" },
        gameWindowId: 1,
        launch: { requestedAt: 0, username: "Hero" },
        login: { state: "select-server" },
        rendererGeneration: 1,
        revision: 1,
        script: { state: "idle" },
        updatedAt: 0,
      }),
    ).toEqual({
      message: "Select a server",
      status: "stopped",
      username: "Hero",
    });
  });

  it("keeps the last observed identity ahead of launch intent", () => {
    expect(
      presentAccountGameSession({
        connection: { lastUsername: "Bob", state: "offline" },
        gameWindowId: 1,
        launch: { requestedAt: 0, username: "Alice" },
        login: { state: "idle" },
        rendererGeneration: 1,
        revision: 2,
        script: { state: "idle" },
        updatedAt: 1,
      }),
    ).toMatchObject({ username: "Bob" });
  });
});
