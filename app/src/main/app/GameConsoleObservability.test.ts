import { describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_GAME_CONSOLE_OBSERVABILITY_PORT,
  DEFAULT_GAME_CONSOLE_MAX_MESSAGE_BYTES,
  makeGameConsoleStore,
  messagesToNdjson,
  sessionsFromAccountState,
} from "./GameConsoleObservability";
import type { AccountManagerState } from "@lucent/core/accounts";

describe("GameConsoleObservability store", () => {
  it("keeps username values from message capture time", () => {
    const store = makeGameConsoleStore();
    store.openWindow(10, "2026-07-08T12:00:00.000Z");

    store.updateSessions([{ gameWindowId: 10, username: "alpha" }]);
    const first = store.appendMessage({
      at: "2026-07-08T12:00:01.000Z",
      gameWindowId: 10,
      message: "first",
    });

    store.updateSessions([{ gameWindowId: 10, username: "bravo" }]);
    const second = store.appendMessage({
      at: "2026-07-08T12:00:02.000Z",
      gameWindowId: 10,
      message: "second",
    });

    expect(first.username).toBe("alpha");
    expect(second.username).toBe("bravo");
    expect(store.queryMessages().map((message) => message.username)).toEqual([
      "alpha",
      "bravo",
    ]);
  });

  it("uses the session username when account state arrives before window state", () => {
    const store = makeGameConsoleStore();

    store.updateSessions([{ gameWindowId: 11, username: "early" }]);
    store.openWindow(11, "2026-07-08T12:00:00.000Z");
    const row = store.appendMessage({
      at: "2026-07-08T12:00:01.000Z",
      gameWindowId: 11,
      message: "after open",
    });

    expect(row.username).toBe("early");
  });

  it("bounds rows, counts drops, and caps individual messages", () => {
    const store = makeGameConsoleStore({ maxMessageBytes: 5, maxRows: 2 });
    store.openWindow(1);

    store.appendMessage({ gameWindowId: 1, message: "one" });
    store.appendMessage({ gameWindowId: 1, message: "two" });
    store.appendMessage({ gameWindowId: 1, message: "123456789" });

    expect(store.queryMessages()).toEqual([
      expect.objectContaining({ id: 2, message: "two" }),
      expect.objectContaining({ id: 3, message: "12345" }),
    ]);
    expect(store.state().buffer).toEqual({
      dropped: 1,
      maxMessageBytes: 5,
      maxRows: 2,
      size: 2,
    });
  });

  it("retains closed window messages and state", () => {
    const store = makeGameConsoleStore();
    store.openWindow(7, "2026-07-08T12:00:00.000Z");
    store.appendMessage({
      at: "2026-07-08T12:00:01.000Z",
      gameWindowId: 7,
      message: "before close",
    });
    store.closeWindow(7, "2026-07-08T12:00:02.000Z");

    expect(store.queryMessages({ windowId: 7 })).toHaveLength(1);
    expect(store.state().windows).toEqual([
      expect.objectContaining({
        closedAt: "2026-07-08T12:00:02.000Z",
        gameWindowId: 7,
        state: "closed",
      }),
    ]);
  });

  it("starts a new generation without discarding prior logs", () => {
    const store = makeGameConsoleStore();
    store.openWindow(1, "2026-07-08T12:00:00.000Z");
    store.openWindow(2, "2026-07-08T12:00:00.000Z");
    store.updateSessions([
      { gameWindowId: 1, username: "Alpha" },
      { gameWindowId: 2, username: "Bravo" },
    ]);
    store.appendMessage({ gameWindowId: 1, message: "old run" });
    store.appendMessage({ gameWindowId: 2, message: "other window" });

    const generationState = store.beginWindowGeneration(1);

    expect(store.queryMessages()).toEqual([
      expect.objectContaining({
        gameWindowId: 1,
        generation: 1,
        message: "old run",
      }),
      expect.objectContaining({ gameWindowId: 2, message: "other window" }),
    ]);
    expect(generationState).toEqual(
      expect.objectContaining({
        gameWindowId: 1,
        generation: 2,
        lastMessageAt: null,
        lastMessageId: null,
        messageCount: 0,
        state: "active",
        username: "Alpha",
      }),
    );
    expect(store.state().buffer.size).toBe(2);

    const nextRun = store.appendMessage({
      gameWindowId: 1,
      message: "new run",
    });
    expect(nextRun).toEqual(
      expect.objectContaining({ generation: 2, id: 3, username: "Alpha" }),
    );
    expect(store.state().buffer.size).toBe(3);
    expect(
      store
        .queryMessages({ generation: 1 })
        .map(({ gameWindowId }) => gameWindowId),
    ).toEqual([1, 2]);
    expect(
      store
        .queryMessages({ generation: 2 })
        .map(({ gameWindowId }) => gameWindowId),
    ).toEqual([1]);
    expect(
      store
        .queryMessages({ generation: 1, windowId: 1 })
        .map(({ message }) => message),
    ).toEqual(["old run"]);
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

  it("maps account sessions to one username field", () => {
    const state: AccountManagerState = {
      accounts: [],
      groups: {},
      sessions: [
        {
          currentUsername: "current",
          gameWindowId: 1,
          launchUsername: "launch",
          status: "running",
          updatedAt: 1,
        },
        {
          gameWindowId: 2,
          launchUsername: "launch-only",
          status: "starting",
          updatedAt: 2,
        },
      ],
      storagePath: "/tmp/accounts.json",
    };

    expect(sessionsFromAccountState(state)).toEqual([
      { gameWindowId: 1, username: "current" },
      { gameWindowId: 2, username: "launch-only" },
    ]);
  });

  it("uses a 1 MiB default message cap", () => {
    expect(DEFAULT_GAME_CONSOLE_MAX_MESSAGE_BYTES).toBe(1024 * 1024);
  });

  it("uses the fixed debug observability port", () => {
    expect(DEFAULT_GAME_CONSOLE_OBSERVABILITY_PORT).toBe(10_637);
  });
});
