import { describe, expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Option, Random } from "effect";
import * as TestClock from "effect/testing/TestClock";

import {
  PUBLIC_ROOM_POLICY,
  RANDOM_PRIVATE_ROOM_POLICY,
  type RoomPolicy,
} from "@lucent/core/accountSettings";
import { minimumPrivateRoom } from "../flash/domain/MapTarget";
import {
  makeMoveToSafeDestination,
  retrySafeMove,
  runWithSafeStartStop,
  type SafeMoveAttemptResult,
  type SafeStartStopServices,
} from "./safeStartStop";

const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(duration);
    yield* Effect.yieldNow;
  });

describe("safeStartStop", () => {
  it.effect("runs the safe stop when the script fiber is interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const phases: string[] = [];
        const started = yield* Deferred.make<void>();
        const fiber = yield* runWithSafeStartStop(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
          Effect.succeed(true),
          (phase) =>
            Effect.sync(() => {
              phases.push(phase);
            }),
        ).pipe(Effect.forkScoped);

        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);

        expect(phases).toEqual(["before", "after"]);
      }),
    ),
  );

  it.effect("aborts the house move when the connection is unavailable", () =>
    Effect.gen(function* () {
      let usernameRead = false;
      let bridgeRead = false;
      let combatExitCount = 0;
      let packetSendCount = 0;
      const services = {
        auth: {
          getUsername: () =>
            Effect.sync(() => {
              usernameRead = true;
              return "Local Player";
            }),
          isLoggedIn: () => Effect.succeed(false),
        },
        bridge: {
          invokeJson: () =>
            Effect.sync(() => {
              bridgeRead = true;
              return Option.some(false);
            }),
        },
        combat: {
          exit: () =>
            Effect.sync(() => {
              combatExitCount += 1;
              return true;
            }),
        },
        packet: {
          sendServer: () =>
            Effect.sync(() => {
              packetSendCount += 1;
              return true;
            }),
        },
        player: {},
        wait: {},
      } as unknown as SafeStartStopServices;

      yield* makeMoveToSafeDestination(services)("after");

      expect(usernameRead).toBe(false);
      expect(bridgeRead).toBe(false);
      expect(combatExitCount).toBe(0);
      expect(packetSendCount).toBe(0);
    }),
  );

  it.effect(
    "moves to the local player's house from another player's house",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let inOwnHouse = false;
          let combatExitCount = 0;
          const sentPackets: string[] = [];
          const combatExited = yield* Deferred.make<void>();
          const services = {
            auth: {
              getUsername: () => Effect.succeed("Local Player"),
              isLoggedIn: () => Effect.succeed(true),
            },
            bridge: {
              invoke: (method: string) =>
                Effect.succeed(
                  method === "flash.isNull" ? Option.some(true) : Option.none(),
                ),
              invokeJson: (method: string) =>
                Effect.sync(() =>
                  method === "flash.callGameFunction0"
                    ? Option.some(inOwnHouse)
                    : Option.none(),
                ),
            },
            combat: {
              exit: () =>
                Effect.sync(() => {
                  combatExitCount += 1;
                }).pipe(
                  Effect.andThen(Deferred.succeed(combatExited, undefined)),
                  Effect.as(true),
                ),
            },
            house: {
              getAll: () =>
                Effect.succeed([{ category: "House", equipped: true }]),
            },
            packet: {
              sendServer: (packet: string) =>
                Effect.sync(() => {
                  sentPackets.push(packet);
                  inOwnHouse = true;
                  return true;
                }),
            },
            player: {
              isAlive: () => Effect.succeed(true),
              isReady: () => Effect.succeed(true),
            },
            wait: {
              untilSome: (condition: Effect.Effect<Option.Option<unknown>>) =>
                condition.pipe(Effect.map(Option.getOrNull)),
            },
          } as unknown as SafeStartStopServices;
          const resultFiber = yield* makeMoveToSafeDestination(services)(
            "before",
          ).pipe(Effect.forkScoped);

          yield* Deferred.await(combatExited);
          yield* Effect.yieldNow;
          yield* advance("1 second");
          yield* Fiber.join(resultFiber);

          expect(combatExitCount).toBe(1);
          expect(sentPackets).toEqual(["%xt%zm%house%1%Local Player%"]);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "routes a decor-only house inventory directly to public buyhouse",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const joinedMaps: string[] = [];
          const sentPackets: string[] = [];
          const combatExited = yield* Deferred.make<void>();
          const services = {
            auth: {
              getUsername: () => Effect.succeed("Local Player"),
              isLoggedIn: () => Effect.succeed(true),
            },
            bridge: {
              invoke: (method: string) =>
                Effect.succeed(
                  method === "flash.isNull" ? Option.some(true) : Option.none(),
                ),
              invokeJson: () => Effect.succeed(Option.some(false)),
            },
            combat: {
              exit: () =>
                Deferred.succeed(combatExited, undefined).pipe(Effect.as(true)),
            },
            house: {
              getAll: () =>
                Effect.succeed([{ category: "Floor Item", equipped: true }]),
            },
            map: {
              getName: () => Effect.succeed("battleon"),
              getRoomNumber: () => Effect.succeed(1),
            },
            packet: {
              sendServer: (packet: string) =>
                Effect.sync(() => {
                  sentPackets.push(packet);
                  return true;
                }),
            },
            player: {
              isAlive: () => Effect.succeed(true),
              isReady: () => Effect.succeed(true),
              joinMap: (map: string) =>
                Effect.sync(() => {
                  joinedMaps.push(map);
                  return true;
                }),
            },
            roomPolicy: Effect.succeed(PUBLIC_ROOM_POLICY),
            wait: {
              untilSome: (condition: Effect.Effect<Option.Option<unknown>>) =>
                condition.pipe(Effect.map(Option.getOrNull)),
            },
          } as unknown as SafeStartStopServices;
          const resultFiber = yield* makeMoveToSafeDestination(services)(
            "before",
          ).pipe(Effect.forkScoped);

          yield* Deferred.await(combatExited);
          yield* advance("1 second");
          yield* Fiber.join(resultFiber);

          expect(joinedMaps).toEqual(["buyhouse"]);
          expect(sentPackets).toEqual([]);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reuses one private buyhouse target across retries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const joinedMaps: string[] = [];
        const combatExited = yield* Deferred.make<void>();
        const services = {
          auth: {
            getUsername: () => Effect.succeed("Local Player"),
            isLoggedIn: () => Effect.succeed(true),
          },
          bridge: {
            invoke: (method: string) =>
              Effect.succeed(
                method === "flash.isNull" ? Option.some(true) : Option.none(),
              ),
            invokeJson: () => Effect.succeed(Option.some(false)),
          },
          combat: {
            exit: () =>
              Deferred.succeed(combatExited, undefined).pipe(Effect.as(true)),
          },
          house: {
            getAll: () => Effect.succeed([]),
          },
          map: {
            getName: () => Effect.succeed("buyhouse"),
            getRoomNumber: () => Effect.succeed(1),
          },
          packet: {
            sendServer: () => Effect.succeed(true),
          },
          player: {
            isAlive: () => Effect.succeed(true),
            isReady: () => Effect.succeed(true),
            joinMap: (map: string) =>
              Effect.sync(() => {
                joinedMaps.push(map);
                return joinedMaps.length === 3;
              }),
          },
          roomPolicy: Effect.succeed<RoomPolicy>({
            kind: "specific",
            roomNumber: minimumPrivateRoom,
          }),
          wait: {
            untilSome: (condition: Effect.Effect<Option.Option<unknown>>) =>
              condition.pipe(Effect.map(Option.getOrNull)),
          },
        } as unknown as SafeStartStopServices;
        const resultFiber = yield* makeMoveToSafeDestination(services)(
          "after",
        ).pipe(Effect.forkScoped);

        yield* Deferred.await(combatExited);
        yield* advance("1 second");
        expect(joinedMaps).toEqual([`buyhouse-${minimumPrivateRoom}`]);

        yield* advance("1 second");
        expect(joinedMaps).toEqual([
          `buyhouse-${minimumPrivateRoom}`,
          `buyhouse-${minimumPrivateRoom}`,
        ]);

        yield* advance("2 seconds");
        yield* Fiber.join(resultFiber);
        expect(joinedMaps).toEqual([
          `buyhouse-${minimumPrivateRoom}`,
          `buyhouse-${minimumPrivateRoom}`,
          `buyhouse-${minimumPrivateRoom}`,
        ]);
      }),
    ).pipe(
      Effect.provide(TestClock.layer()),
      Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      }),
    ),
  );

  it.effect("accepts an existing buyhouse room that satisfies the policy", () =>
    Effect.gen(function* () {
      for (const [currentRoomNumber, roomPolicy] of [
        [minimumPrivateRoom, RANDOM_PRIVATE_ROOM_POLICY],
        [42, { kind: "specific", roomNumber: 42 }],
      ] as const) {
        let combatExitCount = 0;
        let joinCount = 0;
        const services = {
          auth: {
            getUsername: () => Effect.succeed("Local Player"),
            isLoggedIn: () => Effect.succeed(true),
          },
          bridge: {
            invokeJson: () => Effect.succeed(Option.some(false)),
          },
          combat: {
            exit: () =>
              Effect.sync(() => {
                combatExitCount += 1;
                return true;
              }),
          },
          house: {
            getAll: () => Effect.succeed([]),
          },
          map: {
            getName: () => Effect.succeed("buyhouse"),
            getRoomNumber: () => Effect.succeed(currentRoomNumber),
          },
          packet: {},
          player: {
            joinMap: () =>
              Effect.sync(() => {
                joinCount += 1;
                return true;
              }),
          },
          roomPolicy: Effect.succeed<RoomPolicy>(roomPolicy),
          wait: {},
        } as unknown as SafeStartStopServices;

        yield* makeMoveToSafeDestination(services)("before");

        expect(combatExitCount).toBe(0);
        expect(joinCount).toBe(0);
      }
    }),
  );

  it.effect("makes three attempts with exponential backoff", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attemptTimes: number[] = [];
        const resultFiber = yield* retrySafeMove(
          Effect.gen(function* () {
            attemptTimes.push(yield* Clock.currentTimeMillis);
            return "retry" as const;
          }),
        ).pipe(Effect.forkScoped);

        yield* Effect.yieldNow;
        expect(attemptTimes).toEqual([0]);

        yield* advance("1 second");
        expect(attemptTimes).toEqual([0, 1_000]);

        yield* advance("2 seconds");
        expect(yield* Fiber.join(resultFiber)).toBe("timed-out");
        expect(attemptTimes).toEqual([0, 1_000, 3_000]);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("stops retrying after a successful move", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0;
        const resultFiber = yield* retrySafeMove(
          Effect.sync<SafeMoveAttemptResult>(() => {
            attempts += 1;
            return attempts === 2 ? "moved" : "retry";
          }),
        ).pipe(Effect.forkScoped);

        yield* Effect.yieldNow;
        yield* advance("1 second");

        expect(yield* Fiber.join(resultFiber)).toBe("moved");
        expect(attempts).toBe(2);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("does not retry an aborted move", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const result = yield* retrySafeMove(
        Effect.sync<SafeMoveAttemptResult>(() => {
          attempts += 1;
          return "aborted";
        }),
      );

      expect(result).toBe("aborted");
      expect(attempts).toBe(1);
    }),
  );
});
