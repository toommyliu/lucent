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
  readonly gameBrowserWindowId: number;
  readonly gate: Deferred.Deferred<EnvironmentBoostDiscovery>;
}

interface PendingBoostWithdrawal {
  readonly gameBrowserWindowId: number;
  readonly gate: Deferred.Deferred<readonly number[]>;
}

export interface GameEnvironmentsShape {
  readonly fetchBoosts: (
    gameBrowserWindowId: number,
  ) => Effect.Effect<EnvironmentBoostDiscovery>;
  readonly get: (
    gameBrowserWindowId: number,
  ) => Effect.Effect<EnvironmentState>;
  readonly remove: (gameBrowserWindowId: number) => Effect.Effect<void>;
  readonly respondToBoostFetch: (
    gameBrowserWindowId: number,
    requestId: string,
    discovery: EnvironmentBoostDiscovery,
  ) => Effect.Effect<void>;
  readonly respondToBoostWithdrawal: (
    gameBrowserWindowId: number,
    requestId: string,
    itemIds: readonly number[],
  ) => Effect.Effect<void>;
  readonly set: (
    gameBrowserWindowId: number,
    state: EnvironmentState,
  ) => Effect.Effect<EnvironmentState>;
  readonly update: (
    gameBrowserWindowId: number,
    reducer: (state: EnvironmentState) => EnvironmentState,
  ) => Effect.Effect<EnvironmentState>;
  readonly withdrawBoosts: (
    gameBrowserWindowId: number,
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

  const get: GameEnvironmentsShape["get"] = (gameBrowserWindowId) =>
    Effect.sync(() => {
      const state =
        states.get(gameBrowserWindowId) ?? createEmptyEnvironmentState();
      const normalized = normalizeEnvironmentState(state);
      states.set(gameBrowserWindowId, normalized);
      return normalized;
    });

  const set: GameEnvironmentsShape["set"] = (gameBrowserWindowId, state) =>
    Effect.sync(() => {
      const normalized = normalizeEnvironmentState(state);
      states.set(gameBrowserWindowId, normalized);
      return normalized;
    });

  const update: GameEnvironmentsShape["update"] = (
    gameBrowserWindowId,
    reducer,
  ) =>
    Effect.sync(() => {
      const current =
        states.get(gameBrowserWindowId) ?? createEmptyEnvironmentState();
      const next = normalizeEnvironmentState(reducer(current));
      states.set(gameBrowserWindowId, next);
      return next;
    });

  const cancelPending = (gameBrowserWindowId: number) =>
    Effect.gen(function* () {
      for (const [requestId, pending] of pendingBoostFetches) {
        if (pending.gameBrowserWindowId === gameBrowserWindowId) {
          pendingBoostFetches.delete(requestId);
          yield* Deferred.succeed(pending.gate, emptyBoostDiscovery());
        }
      }
      for (const [requestId, pending] of pendingBoostWithdrawals) {
        if (pending.gameBrowserWindowId === gameBrowserWindowId) {
          pendingBoostWithdrawals.delete(requestId);
          yield* Deferred.succeed(pending.gate, []);
        }
      }
    });

  const remove: GameEnvironmentsShape["remove"] = (gameBrowserWindowId) =>
    cancelPending(gameBrowserWindowId).pipe(
      Effect.andThen(Effect.sync(() => states.delete(gameBrowserWindowId))),
      Effect.asVoid,
    );

  const respondToBoostFetch: GameEnvironmentsShape["respondToBoostFetch"] = (
    gameBrowserWindowId,
    requestId,
    discovery,
  ) =>
    Effect.gen(function* () {
      const pending = pendingBoostFetches.get(requestId);
      if (
        pending === undefined ||
        pending.gameBrowserWindowId !== gameBrowserWindowId
      ) {
        return;
      }

      pendingBoostFetches.delete(requestId);
      yield* Deferred.succeed(pending.gate, discovery);
    });

  const respondToBoostWithdrawal: GameEnvironmentsShape["respondToBoostWithdrawal"] =
    (gameBrowserWindowId, requestId, itemIds) =>
      Effect.gen(function* () {
        const pending = pendingBoostWithdrawals.get(requestId);
        if (
          pending === undefined ||
          pending.gameBrowserWindowId !== gameBrowserWindowId
        ) {
          return;
        }

        pendingBoostWithdrawals.delete(requestId);
        yield* Deferred.succeed(pending.gate, [...itemIds]);
      });

  const fetchBoosts: GameEnvironmentsShape["fetchBoosts"] = (
    gameBrowserWindowId,
  ) =>
    Effect.gen(function* () {
      const rendererReady = yield* windows
        .isRendererReady(gameBrowserWindowId)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!rendererReady) {
        return emptyBoostDiscovery();
      }

      const requestId = createRandomId("environment-boost-fetch");
      const gate = yield* Deferred.make<EnvironmentBoostDiscovery>();
      pendingBoostFetches.set(requestId, {
        gameBrowserWindowId,
        gate,
      });

      yield* ipc.sendToBrowserWindowIds(
        [gameBrowserWindowId],
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
    gameBrowserWindowId,
    itemIds,
  ) =>
    Effect.gen(function* () {
      const rendererReady = yield* windows
        .isRendererReady(gameBrowserWindowId)
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
        gameBrowserWindowId,
        gate,
      });

      yield* ipc.sendToBrowserWindowIds(
        [gameBrowserWindowId],
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
    event.kind === "game" ? remove(event.browserWindowId) : Effect.void,
  );
  const unsubscribeDestroyed = yield* windows.onRendererDestroyed((event) =>
    event.kind === "game" ? cancelPending(event.browserWindowId) : Effect.void,
  );
  const unsubscribeReloaded = yield* windows.onRendererReloaded((event) =>
    event.kind === "game" ? cancelPending(event.browserWindowId) : Effect.void,
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeClosed();
      unsubscribeDestroyed();
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
