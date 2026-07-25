import {
  createIdleFollowerState,
  normalizeFollowerState,
  type FollowerConfig,
  type FollowerState,
} from "@lucent/core/follower";
import { Context, Deferred, Effect, Layer, Option, Schema } from "effect";

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

export class GameFollowerRequestError extends Schema.TaggedErrorClass<GameFollowerRequestError>()(
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
  readonly gameBrowserWindowId: number;
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
  readonly get: (gameBrowserWindowId: number) => Effect.Effect<FollowerState>;
  readonly getPlayers: (
    gameBrowserWindowId: number,
  ) => Effect.Effect<FollowerPlayers>;
  readonly remove: (gameBrowserWindowId: number) => Effect.Effect<void>;
  readonly request: (
    gameBrowserWindowId: number,
    input: FollowerCommandInput,
  ) => Effect.Effect<FollowerCommandOutcome, GameFollowerRequestError>;
  readonly respond: (
    gameBrowserWindowId: number,
    response: FollowerCommandResponse,
  ) => Effect.Effect<void>;
  readonly set: (
    gameBrowserWindowId: number,
    state: FollowerState,
  ) => Effect.Effect<FollowerState>;
  readonly setPlayers: (
    gameBrowserWindowId: number,
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
  const playersByGame = new Map<number, FollowerPlayers>();
  const pendingCommands = new Map<string, PendingCommand>();

  const get: GameFollowersShape["get"] = (gameBrowserWindowId) =>
    Effect.sync(() =>
      normalizeFollowerState(
        states.get(gameBrowserWindowId) ?? createIdleFollowerState(),
      ),
    );

  const set: GameFollowersShape["set"] = (gameBrowserWindowId, state) =>
    Effect.sync(() => {
      const normalized = normalizeFollowerState(state);
      states.set(gameBrowserWindowId, normalized);
      return normalized;
    });

  const getPlayers: GameFollowersShape["getPlayers"] = (gameBrowserWindowId) =>
    Effect.sync(() => playersByGame.get(gameBrowserWindowId) ?? []);

  const setPlayers: GameFollowersShape["setPlayers"] = (
    gameBrowserWindowId,
    incoming,
  ) =>
    Effect.sync(() => {
      const current = playersByGame.get(gameBrowserWindowId);
      const players = [...incoming];
      const changed =
        current === undefined ||
        current.length !== players.length ||
        current.some((player, index) => player !== players[index]);
      if (changed) {
        playersByGame.set(gameBrowserWindowId, players);
      }
      return {
        changed,
        players: changed ? players : current,
      };
    });

  const remove: GameFollowersShape["remove"] = (gameBrowserWindowId) =>
    Effect.gen(function* () {
      states.delete(gameBrowserWindowId);
      const players = playersByGame.get(gameBrowserWindowId);
      playersByGame.delete(gameBrowserWindowId);
      if (players !== undefined && players.length > 0) {
        const targets = yield* windows
          .getOwnedBrowserWindowIds(gameBrowserWindowId, "follower")
          .pipe(Effect.catch(() => Effect.succeed([])));
        yield* ipc.sendToBrowserWindowIds(
          targets,
          FollowerIpc.playersChanged,
          [],
        );
      }
      for (const [requestId, pending] of pendingCommands) {
        if (pending.gameBrowserWindowId !== gameBrowserWindowId) {
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

  const request: GameFollowersShape["request"] = Effect.fn(
    "GameFollowers.request",
  )(function* (gameBrowserWindowId, input) {
    const requestId = createRandomId("follower-command");
    const gate = yield* Deferred.make<
      FollowerCommandOutcome,
      GameFollowerRequestError
    >();
    pendingCommands.set(requestId, {
      gameBrowserWindowId,
      gate,
      kind: input.kind,
    });
    const command = {
      ...input,
      requestId,
    } as FollowerCommand;

    yield* ipc.sendToBrowserWindowIds(
      [gameBrowserWindowId],
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
  )(function* (gameBrowserWindowId, response) {
    const pending = pendingCommands.get(response.requestId);
    if (
      pending === undefined ||
      pending.gameBrowserWindowId !== gameBrowserWindowId
    ) {
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
    event.kind === "game" ? remove(event.browserWindowId) : Effect.void,
  );
  const unsubscribeDestroyed = yield* windows.onRendererDestroyed((event) =>
    event.kind === "game" ? remove(event.browserWindowId) : Effect.void,
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeClosed();
      unsubscribeDestroyed();
    }),
  );

  return GameFollowers.of({
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
