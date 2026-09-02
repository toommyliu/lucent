import {
  createIdleFollowerState,
  normalizeFollowerState,
  type FollowerConfig,
  type FollowerState,
} from "@lucent/core/follower";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  FollowerIpc,
  type FollowerCommand,
  type FollowerCommandOutcome,
  type FollowerCommandResponse,
  type FollowerPlayers,
} from "../../../shared/ipc/follower";
import { createRandomId } from "../../../shared/randomId";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";

export const FOLLOWER_COMMAND_TIMEOUT_MS = 5_000;

export type FollowerCommandInput =
  | { readonly config: FollowerConfig; readonly kind: "configure" }
  | { readonly kind: "get-state" }
  | { readonly kind: "me" }
  | { readonly config: FollowerConfig; readonly kind: "start" }
  | { readonly kind: "stop" };

export class GameFollowerRequestError extends Schema.TaggedError<GameFollowerRequestError>()(
  "GameFollowerRequestError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

interface PendingCommand {
  readonly gameRendererId: number;
  readonly gate: Deferred.Deferred<
    FollowerCommandOutcome,
    GameFollowerRequestError
  >;
  readonly kind: FollowerCommand["kind"];
}

interface FollowerPlayersUpdate {
  readonly changed: boolean;
  readonly players: FollowerPlayers;
}

export interface GameFollowersShape {
  readonly getConfig: (
    gameRendererId: number,
  ) => Effect.Effect<FollowerConfig | null>;
  readonly get: (gameRendererId: number) => Effect.Effect<FollowerState>;
  readonly getPlayers: (
    gameRendererId: number,
  ) => Effect.Effect<FollowerPlayers>;
  readonly remove: (gameRendererId: number) => Effect.Effect<void>;
  readonly request: (
    gameRendererId: number,
    input: FollowerCommandInput,
  ) => Effect.Effect<FollowerCommandOutcome, GameFollowerRequestError>;
  readonly respond: (
    gameRendererId: number,
    response: FollowerCommandResponse,
  ) => Effect.Effect<void>;
  readonly set: (
    gameRendererId: number,
    state: FollowerState,
  ) => Effect.Effect<FollowerState>;
  readonly setPlayers: (
    gameRendererId: number,
    players: FollowerPlayers,
  ) => Effect.Effect<FollowerPlayersUpdate>;
}

export class GameFollowers extends Context.Service<
  GameFollowers,
  GameFollowersShape
>()("lucent/internal/follower/GameFollowers") {}

export const makeGameFollowers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc;
  const windows = yield* DesktopWindows;
  const states = new Map<number, FollowerState>();
  // Desired configuration survives renderer generations and is reconciled on ready.
  const configs = new Map<number, FollowerConfig>();
  const playersByGame = new Map<number, FollowerPlayers>();
  const pendingCommands = new Map<string, PendingCommand>();

  const get: GameFollowersShape["get"] = (gameRendererId) =>
    windows.isRendererReady(gameRendererId).pipe(
      Effect.map((rendererReady) =>
        rendererReady
          ? normalizeFollowerState(
              states.get(gameRendererId) ?? createIdleFollowerState(),
            )
          : createIdleFollowerState(),
      ),
      Effect.catch(() => Effect.succeed(createIdleFollowerState())),
    );

  const getConfig: GameFollowersShape["getConfig"] = (gameRendererId) =>
    Effect.sync(() => configs.get(gameRendererId) ?? null);

  const set: GameFollowersShape["set"] = (gameRendererId, state) =>
    Effect.sync(() => {
      const normalized = normalizeFollowerState(state);
      states.set(gameRendererId, normalized);
      return normalized;
    });

  const getPlayers: GameFollowersShape["getPlayers"] = (gameRendererId) =>
    windows.isRendererReady(gameRendererId).pipe(
      Effect.map((rendererReady) =>
        rendererReady ? (playersByGame.get(gameRendererId) ?? []) : [],
      ),
      Effect.catch(() => Effect.succeed([])),
    );

  const setPlayers: GameFollowersShape["setPlayers"] = (
    gameRendererId,
    incoming,
  ) =>
    Effect.sync(() => {
      const current = playersByGame.get(gameRendererId);
      const players = [...incoming];
      const changed =
        current === undefined ||
        current.length !== players.length ||
        current.some((player, index) => player !== players[index]);
      if (changed) {
        playersByGame.set(gameRendererId, players);
      }
      return {
        changed,
        players: changed ? players : current,
      };
    });

  const invalidate = (gameRendererId: number) =>
    Effect.gen(function* () {
      states.delete(gameRendererId);
      playersByGame.delete(gameRendererId);
      const targets = yield* windows
        .getOwnedRendererIds(gameRendererId, "follower")
        .pipe(Effect.catch(() => Effect.succeed([])));
      yield* Effect.all([
        ipc.sendToRendererIds(
          targets,
          FollowerIpc.changed,
          createIdleFollowerState(),
        ),
        ipc.sendToRendererIds(targets, FollowerIpc.playersChanged, []),
      ]);
      for (const [requestId, pending] of pendingCommands) {
        if (pending.gameRendererId !== gameRendererId) {
          continue;
        }

        pendingCommands.delete(requestId);
        yield* Deferred.fail(
          pending.gate,
          new GameFollowerRequestError({
            detail: "Follower game renderer is unavailable.",
          }),
        );
      }
    });

  const remove: GameFollowersShape["remove"] = (gameRendererId) =>
    invalidate(gameRendererId).pipe(
      Effect.andThen(Effect.sync(() => configs.delete(gameRendererId))),
      Effect.asVoid,
    );

  const request: GameFollowersShape["request"] = Effect.fn(
    "GameFollowers.request",
  )(function* (gameRendererId, input) {
    if (input.kind === "configure" || input.kind === "start") {
      configs.set(gameRendererId, input.config);
    }

    const rendererReady = yield* windows
      .isRendererReady(gameRendererId)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    if (!rendererReady) {
      return yield* new GameFollowerRequestError({
        detail: "The follower game renderer is reloading.",
      });
    }

    const requestId = createRandomId("follower-command");
    const gate = yield* Deferred.make<
      FollowerCommandOutcome,
      GameFollowerRequestError
    >();
    pendingCommands.set(requestId, {
      gameRendererId,
      gate,
      kind: input.kind,
    });
    const command = {
      ...input,
      requestId,
    } as FollowerCommand;

    yield* ipc.sendToRendererIds(
      [gameRendererId],
      FollowerIpc.command,
      command,
    );

    const outcome = yield* Deferred.await(gate).pipe(
      Effect.timeoutOption(FOLLOWER_COMMAND_TIMEOUT_MS),
      Effect.ensuring(
        Effect.sync(() => {
          pendingCommands.delete(requestId);
        }),
      ),
    );
    if (Option.isNone(outcome)) {
      return yield* new GameFollowerRequestError({
        detail: "Follower did not respond.",
      });
    }
    return outcome.value;
  });

  const respond: GameFollowersShape["respond"] = Effect.fn(
    "GameFollowers.respond",
  )(function* (gameRendererId, response) {
    const pending = pendingCommands.get(response.requestId);
    if (pending === undefined || pending.gameRendererId !== gameRendererId) {
      return;
    }

    pendingCommands.delete(response.requestId);
    if (!response.ok) {
      yield* Deferred.fail(
        pending.gate,
        new GameFollowerRequestError({
          detail: response.error || "Follower request failed.",
        }),
      );
      return;
    }

    if (response.outcome.kind !== pending.kind) {
      yield* Deferred.fail(
        pending.gate,
        new GameFollowerRequestError({
          detail: `Follower returned ${response.outcome.kind} for ${pending.kind}.`,
        }),
      );
      return;
    }

    yield* Deferred.succeed(pending.gate, response.outcome);
  });

  const unsubscribeClosed = yield* windows.onClosed((event) =>
    event.kind === "game" ? remove(event.rendererId) : Effect.void,
  );
  const unsubscribeDestroyed = yield* windows.onRendererDestroyed((event) =>
    event.kind === "game" ? invalidate(event.rendererId) : Effect.void,
  );
  const unsubscribeUnavailable = yield* windows.onRendererUnavailable((event) =>
    event.kind === "game" ? invalidate(event.rendererId) : Effect.void,
  );
  const unsubscribeReloaded = yield* windows.onRendererReloaded((event) =>
    event.kind === "game" ? invalidate(event.rendererId) : Effect.void,
  );
  const unsubscribeReady = yield* windows.onRendererReady((event) =>
    event.kind !== "game"
      ? Effect.void
      : Effect.gen(function* () {
          const config = configs.get(event.rendererId);
          if (config === undefined) {
            return;
          }

          const outcome = yield* request(event.rendererId, {
            config,
            kind: "configure",
          });
          if (outcome.kind !== "configure") {
            return;
          }

          const state = yield* set(event.rendererId, outcome.state);
          const targets = yield* windows
            .getOwnedRendererIds(event.rendererId, "follower")
            .pipe(Effect.catch(() => Effect.succeed([])));
          yield* ipc.sendToRendererIds(targets, FollowerIpc.changed, state);
        }).pipe(Effect.catch(() => Effect.void)),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeClosed();
      unsubscribeDestroyed();
      unsubscribeUnavailable();
      unsubscribeReloaded();
      unsubscribeReady();
    }),
  );

  return GameFollowers.of({
    getConfig,
    get,
    getPlayers,
    remove,
    request,
    respond,
    set,
    setPlayers,
  });
});

export const layer = Layer.effect(GameFollowers, makeGameFollowers);
