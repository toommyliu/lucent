import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Duration from "effect/Duration";

import type { ProjectionReadinessSnapshot } from "../flash/api/ProjectionReadiness";
import type { ApiService } from "../flash/api/Api";
import { projectionKeys, type ProjectionKey } from "../flash/state/Projection";
import { ScriptNotReadyError } from "./ScriptRunnerErrors";

export type ScriptStartReadinessKey =
  | "account"
  | "login"
  | "playerLoaded"
  | ProjectionKey;

export interface ScriptStartReadinessSnapshot {
  readonly loggedIn: boolean;
  readonly missing: readonly ScriptStartReadinessKey[];
  readonly playerLoaded: boolean;
  readonly projections: AwaitedProjectionReadiness;
  readonly ready: boolean;
  readonly username: string;
}

type AwaitedProjectionReadiness = ProjectionReadinessSnapshot;

interface ScriptStartReadinessServices {
  readonly auth: Pick<ApiService["auth"], "getUsername" | "isLoggedIn">;
  readonly player: Pick<ApiService["player"], "isReady">;
  readonly projectionReadiness: Pick<
    ApiService["projectionReadiness"],
    "inspect"
  >;
  readonly wait: Pick<ApiService["wait"], "untilSome">;
}

export interface ScriptStartReadinessWaitOptions {
  readonly interval?: Duration.Input;
  readonly timeout?: Duration.Input;
}

export const scriptStartReadinessTimeout = "10 seconds";

const labels: Record<ScriptStartReadinessKey, string> = {
  account: "account binding",
  houseInventory: "house inventory projection",
  inventory: "inventory projection",
  login: "login",
  map: "map projection",
  player: "player projection",
  playerLoaded: "live player readiness",
};

const missingDetail = (snapshot: ScriptStartReadinessSnapshot): string =>
  snapshot.missing
    .map((key) => {
      const failure =
        key === "houseInventory" ||
        key === "inventory" ||
        key === "map" ||
        key === "player"
          ? snapshot.projections.failures[key]
          : undefined;
      return failure === undefined
        ? labels[key]
        : `${labels[key]} (${failure})`;
    })
    .join(", ");

export const makeScriptStartReadiness = (
  services: ScriptStartReadinessServices,
) => {
  const get = Effect.fn("ScriptStartReadiness.get")(
    function* (): Effect.fn.Return<ScriptStartReadinessSnapshot> {
      const projections = yield* services.projectionReadiness
        .inspect()
        .pipe(Effect.catchCause(() => Effect.succeed(null)));
      const resolvedProjections =
        projections ??
        ({
          epoch: 0,
          failures: {},
          missing: [...projectionKeys],
          state: {
            houseInventory: false,
            inventory: false,
            map: false,
            player: false,
          },
        } satisfies AwaitedProjectionReadiness);

      // Bridge-backed readiness checks are noisy before the initial packet
      // baseline exists. Projection completion proves the callback path and
      // player model are initialized enough for those checks to be meaningful.
      if (resolvedProjections.missing.length > 0) {
        return {
          loggedIn: false,
          missing: [...resolvedProjections.missing],
          playerLoaded: false,
          projections: resolvedProjections,
          ready: false,
          username: "",
        };
      }

      const playerLoaded = yield* services.player
        .isReady()
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      if (!playerLoaded) {
        return {
          loggedIn: false,
          missing: ["playerLoaded"],
          playerLoaded: false,
          projections: resolvedProjections,
          ready: false,
          username: "",
        };
      }

      const state = yield* Effect.all({
        loggedIn: services.auth
          .isLoggedIn()
          .pipe(Effect.catchCause(() => Effect.succeed(false))),
        username: services.auth
          .getUsername()
          .pipe(Effect.catchCause(() => Effect.succeed(""))),
      });
      const username = state.username.trim().toLowerCase();
      const missing: ScriptStartReadinessKey[] = [];
      if (!state.loggedIn) missing.push("login");
      if (username === "") missing.push("account");

      return {
        loggedIn: state.loggedIn,
        missing,
        playerLoaded,
        projections: resolvedProjections,
        ready: missing.length === 0,
        username,
      } satisfies ScriptStartReadinessSnapshot;
    },
  );

  const awaitReady = Effect.fn("ScriptStartReadiness.awaitReady")(function* (
    options: ScriptStartReadinessWaitOptions = {},
  ) {
    const ready = yield* services.wait.untilSome(
      get().pipe(
        Effect.map((snapshot) =>
          snapshot.ready
            ? Option.some(snapshot)
            : Option.none<ScriptStartReadinessSnapshot>(),
        ),
      ),
      {
        interval: options.interval ?? "100 millis",
        timeout: options.timeout ?? scriptStartReadinessTimeout,
      },
    );
    if (ready !== null) return ready;

    const snapshot = yield* get();
    const detail =
      snapshot.missing.length === 0
        ? "Scripts can only start after game readiness is stable."
        : `Scripts can only start after game readiness is complete. Missing: ${missingDetail(snapshot)}.`;
    return yield* new ScriptNotReadyError({
      detail,
      missing: [...snapshot.missing],
    });
  });

  return { awaitReady, get };
};

export type ScriptStartReadiness = ReturnType<typeof makeScriptStartReadiness>;
