import { Cause, Data, Effect, Option, Schedule, Schema } from "effect";

import type { ApiService } from "../flash/api/Api";
import type { BridgeService } from "../flash/bridge/Bridge";

const maximumHouseMoveAttempts = 3;
const respawnTimeout = "15 seconds";
const returnInfoPath = "world.returnInfo";

export type SafeStartStopPhase = "after" | "before";

export interface SafeStartStopServices {
  readonly auth: ApiService["auth"];
  readonly bridge: BridgeService;
  readonly combat: ApiService["combat"];
  readonly packet: ApiService["packet"];
  readonly player: ApiService["player"];
  readonly wait: ApiService["wait"];
}

class HouseMoveTimeout extends Data.TaggedError("HouseMoveTimeout") {}

export type HouseMoveAttemptResult = "aborted" | "moved" | "retry";
export type HouseMoveResult =
  | Exclude<HouseMoveAttemptResult, "retry">
  | "timed-out";

const houseMoveRetrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.take(maximumHouseMoveAttempts - 1),
);

const warnFailure = (phase: SafeStartStopPhase) =>
  Effect.catchCause((cause: Cause.Cause<unknown>) =>
    Effect.logWarning({
      cause,
      message: `script safeStartStop ${phase}-run house move failed`,
    }),
  );

const abortDisconnected = (phase: SafeStartStopPhase) =>
  Effect.logInfo({
    message: `script safeStartStop ${phase}-run aborted; connection is unavailable`,
  });

export const retryHouseMove = <R>(
  attempt: Effect.Effect<HouseMoveAttemptResult, never, R>,
): Effect.Effect<HouseMoveResult, never, R> =>
  attempt.pipe(
    Effect.flatMap((result) =>
      result === "retry"
        ? Effect.fail(new HouseMoveTimeout())
        : Effect.succeed<HouseMoveResult>(result),
    ),
    Effect.retry(houseMoveRetrySchedule),
    Effect.catchTag("HouseMoveTimeout", () =>
      Effect.succeed<HouseMoveResult>("timed-out"),
    ),
  );

export const runWithSafeStartStop = <A, E, R, OptionsR, MoveR>(
  main: Effect.Effect<A, E, R>,
  isEnabled: Effect.Effect<boolean, never, OptionsR>,
  moveToOwnHouse: (
    phase: SafeStartStopPhase,
  ) => Effect.Effect<void, never, MoveR>,
): Effect.Effect<A, E, R | OptionsR | MoveR> => {
  const moveIfEnabled = (phase: SafeStartStopPhase) =>
    isEnabled.pipe(
      Effect.flatMap((enabled) =>
        enabled ? moveToOwnHouse(phase) : Effect.void,
      ),
    );

  return Effect.gen(function* () {
    yield* moveIfEnabled("before");
    return yield* main;
  }).pipe(Effect.ensuring(moveIfEnabled("after")));
};

export const makeMoveToOwnHouse = (services: SafeStartStopServices) => {
  const { auth, bridge, combat, packet, player, wait } = services;

  const isInOwnHouse = bridge
    .invokeJson("flash.callGameFunction0", ["world.isMyHouse"], Schema.Boolean)
    .pipe(Effect.map(Option.getOrElse(() => false)));

  const setReturnInfo = (value: unknown) =>
    bridge
      .invoke("flash.setGameObject", [returnInfoPath, value], Schema.Void)
      .pipe(Effect.map(Option.isSome));

  const moveToOwnHouse = Effect.fn("ScriptRunner.moveToOwnHouse")(function* (
    phase: SafeStartStopPhase,
  ) {
    if (!(yield* auth.isLoggedIn())) {
      return yield* abortDisconnected(phase);
    }

    const username = (yield* auth.getUsername()).trim();
    if (username === "") {
      yield* Effect.logWarning({
        message: `script safeStartStop ${phase}-run skipped; username is unavailable`,
      });
      return;
    }

    const inOwnHouse = yield* isInOwnHouse;
    if (!(yield* auth.isLoggedIn())) {
      return yield* abortDisconnected(phase);
    }
    if (inOwnHouse) return;

    const alive = yield* player.isAlive();
    if (!(yield* auth.isLoggedIn())) {
      return yield* abortDisconnected(phase);
    }
    if (!alive) {
      yield* Effect.logInfo({
        message: `script safeStartStop ${phase}-run waiting for automatic respawn`,
      });
      const respawn = yield* wait.untilSome(
        Effect.all([auth.isLoggedIn(), player.isAlive()]).pipe(
          Effect.map(([loggedIn, alive]) =>
            !loggedIn
              ? Option.some<"aborted" | "ready">("aborted")
              : alive
                ? Option.some<"aborted" | "ready">("ready")
                : Option.none(),
          ),
        ),
        { timeout: respawnTimeout },
      );
      if (respawn === "aborted") {
        return yield* abortDisconnected(phase);
      }
      if (respawn !== "ready") {
        yield* Effect.logWarning({
          message: `script safeStartStop ${phase}-run skipped; automatic respawn timed out`,
        });
        return;
      }
    }

    const exitedCombat = yield* combat.exit();
    if (!(yield* auth.isLoggedIn())) {
      return yield* abortDisconnected(phase);
    }
    if (!exitedCombat) {
      yield* Effect.logWarning({
        message: `script safeStartStop ${phase}-run skipped; failed to exit combat`,
      });
      return;
    }

    yield* Effect.sleep("1 second");
    if (!(yield* auth.isLoggedIn())) {
      return yield* abortDisconnected(phase);
    }

    const move = Effect.gen(function* () {
      const result = yield* retryHouseMove(
        Effect.gen(function* () {
          if (!(yield* auth.isLoggedIn())) return "aborted";
          if (!(yield* packet.sendServer(`%xt%zm%house%1%${username}%`))) {
            return "retry";
          }
          const outcome = yield* wait.untilSome(
            Effect.all([
              auth.isLoggedIn(),
              isInOwnHouse,
              player.isReady(),
            ]).pipe(
              Effect.map(([loggedIn, ownHouse, ready]) =>
                !loggedIn
                  ? Option.some<HouseMoveAttemptResult>("aborted")
                  : ownHouse && ready
                    ? Option.some<HouseMoveAttemptResult>("moved")
                    : Option.none(),
              ),
            ),
            { timeout: "5 seconds" },
          );
          return outcome ?? "retry";
        }),
      );

      if (result === "aborted") {
        yield* abortDisconnected(phase);
      } else if (result === "timed-out") {
        yield* Effect.logWarning({
          message: `script safeStartStop ${phase}-run house move timed out`,
        });
      }
    });

    // Clear (potentially) stale returnInfo for clean transfer.
    const returnInfoIsNull = yield* bridge.invoke(
      "flash.isNull",
      [returnInfoPath],
      Schema.Boolean,
    );
    if (Option.getOrElse(returnInfoIsNull, () => false)) return yield* move;

    const returnInfo = yield* bridge.invokeJson(
      "flash.getGameObject",
      [returnInfoPath],
      Schema.Unknown,
    );
    if (Option.isNone(returnInfo) || !(yield* setReturnInfo(null))) {
      yield* Effect.logWarning({
        message: `script safeStartStop ${phase}-run skipped; world.returnInfo could not be cleared`,
      });
      return;
    }

    yield* move.pipe(
      Effect.ensuring(setReturnInfo(returnInfo.value).pipe(Effect.asVoid)),
    );
  });

  return (phase: SafeStartStopPhase) =>
    moveToOwnHouse(phase).pipe(warnFailure(phase));
};
