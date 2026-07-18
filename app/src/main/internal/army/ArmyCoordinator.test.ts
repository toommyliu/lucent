import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Result } from "effect";
import * as TestClock from "effect/testing/TestClock";

import type { ArmyConfigPayload } from "@lucent/core/army";
import { makeArmyCoordinator } from "./ArmyCoordinator";

let nextParticipantId = 1;

const makeParticipant = (): number => nextParticipantId++;

const makeConfig = (players: readonly string[]): ArmyConfigPayload => ({
  configName: "test",
  items: {},
  players,
  raw: { players, room: "1234" },
  room: "1234",
  sets: {},
});

describe("ArmyCoordinator", () => {
  it.effect("publishes session-ended events without an IPC dependency", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeArmyCoordinator();
        const participantId = makeParticipant();
        const events: Array<unknown> = [];
        yield* coordinator.onSessionEnded((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        );
        const session = yield* coordinator.join(
          makeConfig(["Alice"]),
          "Alice",
          participantId,
        );

        yield* coordinator.abortSession(session.sessionId, "Test complete");

        expect(events).toEqual([
          {
            participantIds: [participantId],
            reason: "Test complete",
            sessionId: session.sessionId,
          },
        ]);
      }),
    ),
  );

  it.effect("starts only after the full configured roster joins", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeArmyCoordinator();
        const aliceWindow = makeParticipant();
        const bobWindow = makeParticipant();
        const alice = yield* coordinator
          .join(makeConfig(["Alice", "Bob"]), "Alice", aliceWindow)
          .pipe(Effect.forkScoped);

        const bob = yield* coordinator.join(
          makeConfig(["Alice", "Bob"]),
          "Bob",
          bobWindow,
        );
        const alicePayload = yield* Fiber.join(alice);

        expect(alicePayload.role).toBe("leader");
        expect(alicePayload.playerNumber).toBe(1);
        expect(bob.role).toBe("member");
        expect(bob.playerNumber).toBe(2);
      }),
    ),
  );

  it.effect("rejects a second sender for an attached player", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeArmyCoordinator();
        yield* coordinator.join(
          makeConfig(["Alice"]),
          "Alice",
          makeParticipant(),
        );
        const error = yield* Effect.flip(
          coordinator.join(makeConfig(["Alice"]), "Alice", makeParticipant()),
        );
        expect(error.message).toBe("Army player already joined: Alice");
      }),
    ),
  );

  it.effect("rejects operations from a sender that did not join", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeArmyCoordinator();
        const aliceWindow = makeParticipant();
        const session = yield* coordinator.join(
          makeConfig(["Alice"]),
          "Alice",
          aliceWindow,
        );
        const error = yield* Effect.flip(
          coordinator.sync(session.sessionId, makeParticipant(), {
            label: "sync",
            step: 0,
          }),
        );
        expect(error.message).toBe(
          "Army sender is not attached to this session",
        );
        expect((yield* coordinator.getSessions()).length).toBe(1);
      }),
    ),
  );

  it.effect("returns the authenticated canonical roster identity", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeArmyCoordinator();
        const aliceWindow = makeParticipant();
        const bobWindow = makeParticipant();
        const [alice] = yield* Effect.all(
          [
            coordinator.join(
              makeConfig(["Alice", "Bob"]),
              " alice ",
              aliceWindow,
            ),
            coordinator.join(makeConfig(["Alice", "Bob"]), "BOB", bobWindow),
          ],
          { concurrency: "unbounded" },
        );

        expect(
          yield* coordinator.requireParticipant(alice.sessionId, aliceWindow),
        ).toEqual({
          playerCount: 2,
          playerName: "Alice",
          playerNumber: 1,
          sessionId: alice.sessionId,
        });
      }),
    ),
  );

  it.effect("aborts a collecting session when roster startup times out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeArmyCoordinator();
        const pending = yield* coordinator
          .join(makeConfig(["Alice", "Bob"]), "Alice", makeParticipant())
          .pipe(Effect.result, Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("120 seconds");
        const result = yield* Fiber.join(pending);

        expect(Result.isFailure(result)).toBe(true);
        expect((yield* coordinator.getSessions()).length).toBe(0);
      }),
    ),
  );

  it.effect("aborts every waiter when step signatures disagree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeArmyCoordinator();
        const aliceWindow = makeParticipant();
        const bobWindow = makeParticipant();
        const [alice, bob] = yield* Effect.all(
          [
            coordinator.join(
              makeConfig(["Alice", "Bob"]),
              "Alice",
              aliceWindow,
            ),
            coordinator.join(makeConfig(["Alice", "Bob"]), "Bob", bobWindow),
          ],
          { concurrency: "unbounded" },
        );

        const aliceWait = yield* coordinator
          .sync(alice.sessionId, aliceWindow, { label: "first", step: 0 })
          .pipe(Effect.result, Effect.forkScoped);
        const bobError = yield* Effect.flip(
          coordinator.sync(bob.sessionId, bobWindow, {
            label: "second",
            step: 0,
          }),
        );
        const aliceResult = yield* Fiber.join(aliceWait);

        expect(bobError.message).toContain("Army step mismatch for step 0");
        expect(Result.isFailure(aliceResult)).toBe(true);
        expect((yield* coordinator.getSessions()).length).toBe(0);
      }),
    ),
  );

  it.effect(
    "repeats local progress rounds until every player is complete",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const coordinator = yield* makeArmyCoordinator();
          const aliceWindow = makeParticipant();
          const bobWindow = makeParticipant();
          const [alice, bob] = yield* Effect.all(
            [
              coordinator.join(
                makeConfig(["Alice", "Bob"]),
                "Alice",
                aliceWindow,
              ),
              coordinator.join(makeConfig(["Alice", "Bob"]), "Bob", bobWindow),
            ],
            { concurrency: "unbounded" },
          );

          const roundOne = yield* Effect.all(
            [
              coordinator.progress(alice.sessionId, aliceWindow, {
                complete: true,
                label: "kill-item",
                step: 0,
              }),
              coordinator.progress(bob.sessionId, bobWindow, {
                complete: false,
                label: "kill-item",
                step: 0,
              }),
            ],
            { concurrency: "unbounded" },
          );
          expect(roundOne[0]).toEqual({
            complete: false,
            completedPlayers: ["Alice"],
            pendingPlayers: ["Bob"],
          });

          const roundTwo = yield* Effect.all(
            [
              coordinator.progress(alice.sessionId, aliceWindow, {
                complete: true,
                label: "kill-item",
                step: 0,
              }),
              coordinator.progress(bob.sessionId, bobWindow, {
                complete: true,
                label: "kill-item",
                step: 0,
              }),
            ],
            { concurrency: "unbounded" },
          );
          expect(roundTwo[0].complete).toBe(true);
          expect(roundTwo[0].pendingPlayers).toEqual([]);
        }),
      ),
  );
});
