import { describe, expect, it } from "@effect/vitest";

import type { AccountManagerState } from "@lucent/core/accounts";
import {
  makeGameConsoleStore,
  messagesToNdjson,
  sessionsFromAccountState,
} from "./GameConsoleStore";

describe("GameConsoleStore", () => {
  it("retains captured usernames and messages across generations", () => {
    const store = makeGameConsoleStore();
    store.openWindow(1, "2026-08-24T12:00:00.000Z");
    store.updateSessions([{ gameWindowId: 1, username: "Alpha" }]);
    const previous = store.appendMessage({
      gameWindowId: 1,
      message: "previous generation",
    });

    store.updateSessions([{ gameWindowId: 1, username: "Bravo" }]);
    store.beginWindowGeneration(1);
    const current = store.appendMessage({
      gameWindowId: 1,
      message: "current generation",
    });

    expect(previous).toEqual(
      expect.objectContaining({ generation: 1, username: "Alpha" }),
    );
    expect(current).toEqual(
      expect.objectContaining({ generation: 2, username: "Bravo" }),
    );
    expect(store.queryMessages().map(({ message }) => message)).toEqual([
      "previous generation",
      "current generation",
    ]);
  });

  it("bounds rows, byte usage, and individual messages", () => {
    const store = makeGameConsoleStore({
      maxBytes: 8,
      maxMessageBytes: 5,
      maxRows: 2,
    });

    store.appendMessage({ gameWindowId: 1, message: "one" });
    store.appendMessage({ gameWindowId: 1, message: "two" });
    store.appendMessage({ gameWindowId: 1, message: "123456789" });

    expect(store.queryMessages()).toEqual([
      expect.objectContaining({ id: 2, message: "two" }),
      expect.objectContaining({ id: 3, message: "12345" }),
    ]);
    expect(store.state().buffer).toEqual({
      bytes: 8,
      dropped: 1,
      maxBytes: 8,
      maxMessageBytes: 5,
      maxRows: 2,
      size: 2,
    });
  });

  it("filters messages and serializes NDJSON", () => {
    const store = makeGameConsoleStore();
    store.openWindow(1);
    store.openWindow(2);
    store.updateSessions([
      { gameWindowId: 1, username: "Alpha" },
      { gameWindowId: 2, username: "Bravo" },
    ]);
    store.appendMessage({ gameWindowId: 1, message: "hello alpha" });
    store.appendMessage({ gameWindowId: 2, message: "hello bravo" });

    const rows = store.queryMessages({
      q: "HELLO",
      username: "alpha",
      windowId: 1,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        gameWindowId: 1,
        message: "hello alpha",
        username: "Alpha",
      }),
    ]);
    expect(store.queryMessages({ limit: 0 })).toEqual([]);
    expect(messagesToNdjson(rows)).toBe(`${JSON.stringify(rows[0])}\n`);
  });

  it("exposes only online account identities", () => {
    const state: AccountManagerState = {
      accounts: [],
      groups: {},
      sessions: [
        {
          connection: { state: "online", username: "current" },
          gameWindowId: 1,
          launch: { requestedAt: 1, username: "launch" },
          login: { state: "idle" },
          rendererGeneration: 1,
          revision: 1,
          script: { name: "script", state: "running" },
          updatedAt: 1,
        },
        {
          connection: { state: "offline" },
          gameWindowId: 2,
          launch: { requestedAt: 2, username: "launch-only" },
          login: { state: "waiting-for-game" },
          rendererGeneration: 1,
          revision: 1,
          script: { state: "idle" },
          updatedAt: 2,
        },
      ],
      storagePath: "/tmp/accounts.json",
    };

    expect(sessionsFromAccountState(state)).toEqual([
      { gameWindowId: 1, username: "current" },
      { gameWindowId: 2, username: null },
    ]);
  });
});
