import { describe, expect, it } from "@effect/vitest";
import type { BrowserWindow } from "electron";

import type { ArmyConfigPayload } from "../../shared/army";
import { makeArmyCoordinator } from "./ArmyCoordinator";

const makeWindow = (): BrowserWindow =>
  ({
    isDestroyed: () => false,
    once: () => undefined,
    webContents: {
      isDestroyed: () => false,
      once: () => undefined,
    },
  }) as unknown as BrowserWindow;

const makeConfig = (players: readonly string[]): ArmyConfigPayload => ({
  configName: "test",
  items: {},
  players,
  raw: {
    players,
    room: "1234",
  },
  room: "1234",
  sets: {},
});

const expectRejectedError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject");
};

describe("ArmyCoordinator", () => {
  it("resolves start waiters only after every configured player joins", async () => {
    const coordinator = makeArmyCoordinator();
    const session = coordinator.getOrCreateSession(
      makeConfig(["Alice", "Bob"]),
    );
    let aliceSettled = false;

    const alice = coordinator
      .join(session, "Alice", makeWindow())
      .then((payload) => {
        aliceSettled = true;
        return payload;
      });
    await Promise.resolve();
    expect(aliceSettled).toBe(false);

    const [alicePayload, bobPayload] = await Promise.all([
      alice,
      coordinator.join(session, "Bob", makeWindow()),
    ]);

    expect(alicePayload.role).toBe("leader");
    expect(alicePayload.playerNumber).toBe(1);
    expect(bobPayload.role).toBe("member");
    expect(bobPayload.playerNumber).toBe(2);
  });

  it("rejects duplicate live windows for the same player", async () => {
    const coordinator = makeArmyCoordinator();
    const session = coordinator.getOrCreateSession(makeConfig(["Alice"]));
    await coordinator.join(session, "Alice", makeWindow());

    await expect(
      coordinator.join(session, "Alice", makeWindow()),
    ).rejects.toThrow("Army player already joined: Alice");

    coordinator.abortSession(session, "test cleanup");
  });

  it("aborts the session when sync labels mismatch", async () => {
    const coordinator = makeArmyCoordinator();
    const session = coordinator.getOrCreateSession(
      makeConfig(["Alice", "Bob"]),
    );
    await Promise.all([
      coordinator.join(session, "Alice", makeWindow()),
      coordinator.join(session, "Bob", makeWindow()),
    ]);

    const alice = coordinator.waitAtSync(session, "Alice", {
      label: "first",
      step: 0,
    });
    const aliceRejected = expectRejectedError(alice);

    await expect(
      coordinator.waitAtSync(session, "Bob", {
        label: "second",
        step: 0,
      }),
    ).rejects.toThrow(
      "Army sync label mismatch for step 0: expected first, got second",
    );

    await expect(aliceRejected).resolves.toMatchObject({
      message:
        "Army sync label mismatch for step 0: expected first, got second",
    });
    expect(coordinator.getSession(session.sessionId)).toBeUndefined();
  });

  it("returns aggregate progress and allows completed players to keep participating", async () => {
    const coordinator = makeArmyCoordinator();
    const session = coordinator.getOrCreateSession(
      makeConfig(["Alice", "Bob"]),
    );
    await Promise.all([
      coordinator.join(session, "Alice", makeWindow()),
      coordinator.join(session, "Bob", makeWindow()),
    ]);

    const firstRound = await Promise.all([
      coordinator.waitAtProgress(session, "Alice", {
        complete: true,
        label: "kill-item",
        step: 0,
      }),
      coordinator.waitAtProgress(session, "Bob", {
        complete: false,
        label: "kill-item",
        step: 0,
      }),
    ]);

    expect(firstRound).toEqual([
      {
        complete: false,
        completedPlayers: ["Alice"],
        pendingPlayers: ["Bob"],
      },
      {
        complete: false,
        completedPlayers: ["Alice"],
        pendingPlayers: ["Bob"],
      },
    ]);

    const secondRound = await Promise.all([
      coordinator.waitAtProgress(session, "Alice", {
        complete: true,
        label: "kill-item",
        step: 0,
      }),
      coordinator.waitAtProgress(session, "Bob", {
        complete: true,
        label: "kill-item",
        step: 0,
      }),
    ]);

    expect(secondRound).toEqual([
      {
        complete: true,
        completedPlayers: ["Alice", "Bob"],
        pendingPlayers: [],
      },
      {
        complete: true,
        completedPlayers: ["Alice", "Bob"],
        pendingPlayers: [],
      },
    ]);
  });
});
