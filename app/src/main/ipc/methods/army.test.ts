import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { BrowserWindow } from "electron";
import { makeArmyCoordinator } from "../../backend/army/ArmyCoordinator";
import type { ArmySessionState } from "./army";
import { waitAtBarrier, waitAtProgress } from "./army";

vi.mock("electron", () => ({
  BrowserWindow: Object,
}));

const makeWindow = (): BrowserWindow =>
  ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: () => undefined,
    },
  }) as unknown as BrowserWindow;

const makeSessionHarness = (players: readonly string[]) => {
  const runtime = makeArmyCoordinator();
  const session: ArmySessionState = {
    barriers: new Map(),
    configName: "test-army",
    leader: players[0] ?? "Player1",
    loopTaunts: {
      clear: () => undefined,
    } as ArmySessionState["loopTaunts"],
    playerKeys: new Set(players.map((player) => player.toLowerCase())),
    players,
    progressCheckpoints: new Map(),
    raw: {},
    roomNumber: "1234",
    sessionId: "session-1",
    windows: new Map(
      players.map((player) => [player.toLowerCase(), makeWindow()] as const),
    ),
  };

  runtime.setSession(session);
  runtime.setActiveSession(session.configName, session.sessionId);

  return { runtime, session };
};

const expectRejectedError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject");
};

describe("army sync", () => {
  it("keeps completed players in progress loops until every configured player is complete", async () => {
    const { runtime, session } = makeSessionHarness([
      "Player1",
      "Player2",
      "Player3",
      "Player4",
    ]);
    const basePayload = {
      label: "kill-item:Item",
      sessionId: session.sessionId,
      step: 0,
    };

    const round1 = await Promise.all([
      waitAtProgress(runtime, session, "Player1", {
        ...basePayload,
        complete: true,
        playerName: "Player1",
      }),
      waitAtProgress(runtime, session, "Player2", {
        ...basePayload,
        complete: false,
        playerName: "Player2",
      }),
      waitAtProgress(runtime, session, "Player3", {
        ...basePayload,
        complete: true,
        playerName: "Player3",
      }),
      waitAtProgress(runtime, session, "Player4", {
        ...basePayload,
        complete: true,
        playerName: "Player4",
      }),
    ]);

    expect(round1).toEqual([
      {
        complete: false,
        completedPlayers: ["Player1", "Player3", "Player4"],
        pendingPlayers: ["Player2"],
      },
      {
        complete: false,
        completedPlayers: ["Player1", "Player3", "Player4"],
        pendingPlayers: ["Player2"],
      },
      {
        complete: false,
        completedPlayers: ["Player1", "Player3", "Player4"],
        pendingPlayers: ["Player2"],
      },
      {
        complete: false,
        completedPlayers: ["Player1", "Player3", "Player4"],
        pendingPlayers: ["Player2"],
      },
    ]);

    const round2 = await Promise.all(
      session.players.map((playerName) =>
        waitAtProgress(runtime, session, playerName, {
          ...basePayload,
          complete: true,
          playerName,
        }),
      ),
    );

    expect(round2).toEqual(
      session.players.map(() => ({
        complete: true,
        completedPlayers: ["Player1", "Player2", "Player3", "Player4"],
        pendingPlayers: [],
      })),
    );
  });

  it("barriers wait for every configured player by default", async () => {
    const { runtime, session } = makeSessionHarness(["Player1", "Player2"]);
    const payload = {
      label: "sync",
      playerName: "Player1",
      sessionId: session.sessionId,
      step: 0,
    };
    let player1Settled = false;
    const player1 = waitAtBarrier(runtime, session, "Player1", payload).then(
      () => {
        player1Settled = true;
      },
    );

    await Promise.resolve();

    expect(player1Settled).toBe(false);

    const player2 = waitAtBarrier(runtime, session, "Player2", {
      ...payload,
      playerName: "Player2",
    });

    await Promise.all([player1, player2]);
    expect(player1Settled).toBe(true);
  });

  it("keeps participant-scoped and full-army sync steps independent", async () => {
    const { runtime, session } = makeSessionHarness([
      "Player1",
      "Player2",
      "Player3",
      "Player4",
    ]);
    const loopTauntPlayers = ["Player1", "Player3"];

    await Promise.all(
      loopTauntPlayers.map((playerName) =>
        waitAtBarrier(runtime, session, playerName, {
          label: "loop-taunt-target",
          playerName,
          players: loopTauntPlayers,
          sessionId: session.sessionId,
          step: 0,
        }),
      ),
    );

    const progress = await Promise.all(
      session.players.map((playerName) =>
        waitAtProgress(runtime, session, playerName, {
          complete: true,
          label: "kill-temp:Item",
          playerName,
          sessionId: session.sessionId,
          step: 0,
        }),
      ),
    );

    expect(progress).toEqual(
      session.players.map(() => ({
        complete: true,
        completedPlayers: ["Player1", "Player2", "Player3", "Player4"],
        pendingPlayers: [],
      })),
    );
  });

  it("aborts the session when a barrier step label mismatches", async () => {
    const { runtime, session } = makeSessionHarness(["Player1", "Player2"]);
    const player1 = waitAtBarrier(runtime, session, "Player1", {
      label: "first-label",
      playerName: "Player1",
      sessionId: session.sessionId,
      step: 0,
    });
    const player1Rejected = expectRejectedError(player1);

    await expect(
      waitAtBarrier(runtime, session, "Player2", {
        label: "second-label",
        playerName: "Player2",
        sessionId: session.sessionId,
        step: 0,
      }),
    ).rejects.toThrow(
      "Army step label mismatch for step 0: expected first-label, got second-label",
    );

    await expect(player1Rejected).resolves.toMatchObject({
      message:
        "Army step label mismatch for step 0: expected first-label, got second-label",
    });
    expect(runtime.getSession(session.sessionId)).toBeUndefined();
  });

  it("aborts the session when a progress step label mismatches", async () => {
    const { runtime, session } = makeSessionHarness(["Player1", "Player2"]);
    const player1 = waitAtProgress(runtime, session, "Player1", {
      complete: true,
      label: "kill-item:One",
      playerName: "Player1",
      sessionId: session.sessionId,
      step: 0,
    });
    const player1Rejected = expectRejectedError(player1);

    await expect(
      waitAtProgress(runtime, session, "Player2", {
        complete: true,
        label: "kill-item:Two",
        playerName: "Player2",
        sessionId: session.sessionId,
        step: 0,
      }),
    ).rejects.toThrow(
      "Army progress label mismatch for step 0: expected kill-item:One, got kill-item:Two",
    );

    await expect(player1Rejected).resolves.toMatchObject({
      message:
        "Army progress label mismatch for step 0: expected kill-item:One, got kill-item:Two",
    });
    expect(runtime.getSession(session.sessionId)).toBeUndefined();
  });

  it("aborts the session when a player reaches the same barrier twice", async () => {
    const { runtime, session } = makeSessionHarness(["Player1", "Player2"]);
    const player1 = waitAtBarrier(runtime, session, "Player1", {
      label: "sync",
      playerName: "Player1",
      sessionId: session.sessionId,
      step: 0,
    });
    const player1Rejected = expectRejectedError(player1);

    await expect(
      waitAtBarrier(runtime, session, "Player1", {
        label: "sync",
        playerName: "Player1",
        sessionId: session.sessionId,
        step: 0,
      }),
    ).rejects.toThrow("Army player already reached step 0: Player1");

    await expect(player1Rejected).resolves.toMatchObject({
      message: "Army player already reached step 0: Player1",
    });
    expect(runtime.getSession(session.sessionId)).toBeUndefined();
  });

  it("aborts the session when a progress checkpoint times out", async () => {
    vi.useFakeTimers();
    try {
      const { runtime, session } = makeSessionHarness(["Player1", "Player2"]);
      const player1 = waitAtProgress(runtime, session, "Player1", {
        complete: true,
        label: "kill-temp:Item",
        playerName: "Player1",
        sessionId: session.sessionId,
        step: 0,
        timeoutMs: 10,
      });
      const player1Rejected = expectRejectedError(player1);

      await vi.advanceTimersByTimeAsync(10);

      await expect(player1Rejected).resolves.toMatchObject({
        message:
          "Timed out waiting for army progress 0 (kill-temp:Item); missing: Player2",
      });
      expect(runtime.getSession(session.sessionId)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
