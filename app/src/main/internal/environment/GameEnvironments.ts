import {
  createEmptyEnvironmentState,
  normalizeEnvironmentState,
  type EnvironmentState,
} from "@lucent/core/environment";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  EnvironmentIpc,
  type EnvironmentBoostDiscovery,
} from "../../../shared/ipc/environment";
import { createRandomId } from "../../../shared/randomId";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";

export const ENVIRONMENT_BOOST_FETCH_TIMEOUT_MS = 12_000;
export const ENVIRONMENT_BOOST_WITHDRAW_BASE_TIMEOUT_MS = 15_000;
export const ENVIRONMENT_BOOST_WITHDRAW_ITEM_TIMEOUT_MS = 6_000;

const emptyBoostDiscovery = (): EnvironmentBoostDiscovery => ({
  bank: [],
  bankLoaded: false,
  inventory: [],
});

interface PendingBoostFetch {
  readonly gameRendererId: number;
  readonly gate: Deferred.Deferred<EnvironmentBoostDiscovery>;
}

interface PendingBoostWithdrawal {
  readonly gameRendererId: number;
  readonly gate: Deferred.Deferred<readonly number[]>;
}

export interface GameEnvironmentsShape {
  readonly fetchBoosts: (
    gameRendererId: number,
  ) => Effect.Effect<EnvironmentBoostDiscovery>;
  readonly get: (gameRendererId: number) => Effect.Effect<EnvironmentState>;
  readonly remove: (gameRendererId: number) => Effect.Effect<void>;
  readonly respondToBoostFetch: (
    gameRendererId: number,
    requestId: string,
    discovery: EnvironmentBoostDiscovery,
  ) => Effect.Effect<void>;
  readonly respondToBoostWithdrawal: (
    gameRendererId: number,
    requestId: string,
    itemIds: readonly number[],
  ) => Effect.Effect<void>;
  readonly set: (
    gameRendererId: number,
    state: EnvironmentState,
  ) => Effect.Effect<EnvironmentState>;
  readonly update: (
    gameRendererId: number,
    reducer: (state: EnvironmentState) => EnvironmentState,
  ) => Effect.Effect<EnvironmentState>;
  readonly withdrawBoosts: (
    gameRendererId: number,
    itemIds: readonly number[],
  ) => Effect.Effect<readonly number[]>;
}

export class GameEnvironments extends Context.Service<
  GameEnvironments,
  GameEnvironmentsShape
>()("lucent/internal/environment/GameEnvironments") {}

export const makeGameEnvironments = Effect.gen(function* () {
  const ipc = yield* DesktopIpc;
  const windows = yield* DesktopWindows;
  const states = new Map<number, EnvironmentState>();
  const pendingBoostFetches = new Map<string, PendingBoostFetch>();
  const pendingBoostWithdrawals = new Map<string, PendingBoostWithdrawal>();

  const get: GameEnvironmentsShape["get"] = (gameRendererId) =>
    Effect.sync(() => {
      const state = states.get(gameRendererId) ?? createEmptyEnvironmentState();
      const normalized = normalizeEnvironmentState(state);
      states.set(gameRendererId, normalized);
      return normalized;
    });

  const set: GameEnvironmentsShape["set"] = (gameRendererId, state) =>
    Effect.sync(() => {
      const normalized = normalizeEnvironmentState(state);
      states.set(gameRendererId, normalized);
      return normalized;
    });

  const update: GameEnvironmentsShape["update"] = (gameRendererId, reducer) =>
    Effect.sync(() => {
      const current =
        states.get(gameRendererId) ?? createEmptyEnvironmentState();
      const next = normalizeEnvironmentState(reducer(current));
      states.set(gameRendererId, next);
      return next;
    });

  const cancelPending = (gameRendererId: number) =>
    Effect.gen(function* () {
      for (const [requestId, pending] of pendingBoostFetches) {
        if (pending.gameRendererId === gameRendererId) {
          pendingBoostFetches.delete(requestId);
          yield* Deferred.succeed(pending.gate, emptyBoostDiscovery());
        }
      }
      for (const [requestId, pending] of pendingBoostWithdrawals) {
        if (pending.gameRendererId === gameRendererId) {
          pendingBoostWithdrawals.delete(requestId);
          yield* Deferred.succeed(pending.gate, []);
        }
      }
    });

  const remove: GameEnvironmentsShape["remove"] = (gameRendererId) =>
    cancelPending(gameRendererId).pipe(
      Effect.andThen(Effect.sync(() => states.delete(gameRendererId))),
      Effect.asVoid,
    );

  const respondToBoostFetch: GameEnvironmentsShape["respondToBoostFetch"] = (
    gameRendererId,
    requestId,
    discovery,
  ) =>
    Effect.gen(function* () {
      const pending = pendingBoostFetches.get(requestId);
      if (pending === undefined || pending.gameRendererId !== gameRendererId) {
        return;
      }

      pendingBoostFetches.delete(requestId);
      yield* Deferred.succeed(pending.gate, discovery);
    });

  const respondToBoostWithdrawal: GameEnvironmentsShape["respondToBoostWithdrawal"] =
    (gameRendererId, requestId, itemIds) =>
      Effect.gen(function* () {
        const pending = pendingBoostWithdrawals.get(requestId);
        if (
          pending === undefined ||
          pending.gameRendererId !== gameRendererId
        ) {
          return;
        }

        pendingBoostWithdrawals.delete(requestId);
        yield* Deferred.succeed(pending.gate, [...itemIds]);
      });

  const fetchBoosts: GameEnvironmentsShape["fetchBoosts"] = (gameRendererId) =>
    Effect.gen(function* () {
      const rendererReady = yield* windows
        .isRendererReady(gameRendererId)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!rendererReady) {
        return emptyBoostDiscovery();
      }

      const requestId = createRandomId("environment-boost-fetch");
      const gate = yield* Deferred.make<EnvironmentBoostDiscovery>();
      pendingBoostFetches.set(requestId, {
        gameRendererId,
        gate,
      });

      yield* ipc.sendToRendererIds(
        [gameRendererId],
        EnvironmentIpc.fetchBoostsRequest,
        { requestId },
      );

      return yield* Deferred.await(gate).pipe(
        Effect.timeoutOption(ENVIRONMENT_BOOST_FETCH_TIMEOUT_MS),
        Effect.map((result) => Option.getOrElse(result, emptyBoostDiscovery)),
        Effect.ensuring(
          Effect.sync(() => {
            pendingBoostFetches.delete(requestId);
          }),
        ),
      );
    });

  const withdrawBoosts: GameEnvironmentsShape["withdrawBoosts"] = (
    gameRendererId,
    itemIds,
  ) =>
    Effect.gen(function* () {
      const rendererReady = yield* windows
        .isRendererReady(gameRendererId)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!rendererReady) {
        return [];
      }

      const uniqueItemIds = Array.from(new Set(itemIds));
      if (uniqueItemIds.length === 0) {
        return [];
      }

      const requestId = createRandomId("environment-boost-withdraw");
      const gate = yield* Deferred.make<readonly number[]>();
      pendingBoostWithdrawals.set(requestId, {
        gameRendererId,
        gate,
      });

      yield* ipc.sendToRendererIds(
        [gameRendererId],
        EnvironmentIpc.withdrawBoostsRequest,
        { itemIds: uniqueItemIds, requestId },
      );

      const timeoutMs =
        ENVIRONMENT_BOOST_WITHDRAW_BASE_TIMEOUT_MS +
        ENVIRONMENT_BOOST_WITHDRAW_ITEM_TIMEOUT_MS * uniqueItemIds.length;
      return yield* Deferred.await(gate).pipe(
        Effect.timeoutOption(timeoutMs),
        Effect.map((result) => Option.getOrElse(result, () => [])),
        Effect.ensuring(
          Effect.sync(() => {
            pendingBoostWithdrawals.delete(requestId);
          }),
        ),
      );
    });

  const unsubscribeClosed = yield* windows.onClosed((event) =>
    event.kind === "game" ? remove(event.rendererId) : Effect.void,
  );
  const unsubscribeDestroyed = yield* windows.onRendererDestroyed((event) =>
    event.kind === "game" ? cancelPending(event.rendererId) : Effect.void,
  );
  const unsubscribeUnavailable = yield* windows.onRendererUnavailable((event) =>
    event.kind === "game" ? cancelPending(event.rendererId) : Effect.void,
  );
  const unsubscribeReloaded = yield* windows.onRendererReloaded((event) =>
    event.kind === "game" ? cancelPending(event.rendererId) : Effect.void,
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeClosed();
      unsubscribeDestroyed();
      unsubscribeUnavailable();
      unsubscribeReloaded();
    }),
  );

  return GameEnvironments.of({
    fetchBoosts,
    get,
    remove,
    respondToBoostFetch,
    respondToBoostWithdrawal,
    set,
    update,
    withdrawBoosts,
  });
});

export const layer = Layer.effect(GameEnvironments, makeGameEnvironments);
