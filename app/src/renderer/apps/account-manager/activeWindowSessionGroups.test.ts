import { describe, expect, it } from "vitest";

import type { AccountGameSession } from "@lucent/core/accounts";
import { groupActiveWindowSessions } from "./activeWindowSessionGroups";

const session = (
  gameWindowId: number,
  gameWindowGroupId?: number,
): AccountGameSession => ({
  gameWindowId,
  ...(gameWindowGroupId === undefined ? {} : { gameWindowGroupId }),
  connection: { state: "offline" },
  login: { state: "idle" },
  rendererGeneration: 1,
  revision: 1,
  script: { state: "idle" },
  updatedAt: gameWindowId,
});

describe("active window session groups", () => {
  it("coalesces sessions owned by the same BrowserWindow", () => {
    const groups = groupActiveWindowSessions([
      session(1, 10),
      session(2, 20),
      session(3, 10),
    ]);

    expect(
      groups.map(({ key, sessions, shared }) => ({
        ids: sessions.map(({ gameWindowId }) => gameWindowId),
        key,
        shared,
      })),
    ).toEqual([
      { ids: [2], key: "window:20", shared: false },
      { ids: [1, 3], key: "window:10", shared: true },
    ]);
  });

  it("keeps sessions without host metadata independent", () => {
    expect(groupActiveWindowSessions([session(1), session(2)])).toMatchObject([
      { key: "session:1", shared: false },
      { key: "session:2", shared: false },
    ]);
  });

  it("keeps standalone windows ahead of shared windows after reordering", () => {
    const groups = groupActiveWindowSessions([
      session(2, 10),
      session(1, 10),
      session(5, 20),
    ]);

    expect(
      groups.map(({ key, sessions }) => ({
        ids: sessions.map(({ gameWindowId }) => gameWindowId),
        key,
      })),
    ).toEqual([
      { ids: [5], key: "window:20" },
      { ids: [2, 1], key: "window:10" },
    ]);
  });
});
