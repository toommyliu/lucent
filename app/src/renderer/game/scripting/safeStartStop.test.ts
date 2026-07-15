import { describe, expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Option } from "effect";
import * as TestClock from "effect/testing/TestClock";

import {
  makeMoveToOwnHouse,
  retryHouseMove,
  runWithSafeStartStop,
  type HouseMoveAttemptResult,
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

      yield* makeMoveToOwnHouse(services)("after");

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
          const resultFiber = yield* makeMoveToOwnHouse(services)(
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

  it.effect("makes three attempts with exponential backoff", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attemptTimes: number[] = [];
        const resultFiber = yield* retryHouseMove(
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
        const resultFiber = yield* retryHouseMove(
          Effect.sync<HouseMoveAttemptResult>(() => {
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
      const result = yield* retryHouseMove(
        Effect.sync<HouseMoveAttemptResult>(() => {
          attempts += 1;
          return "aborted";
        }),
      );

      expect(result).toBe("aborted");
      expect(attempts).toBe(1);
    }),
  );
});
