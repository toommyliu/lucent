import { BrowserWindow } from "electron";
import { Effect, Layer, ServiceMap } from "effect";
import {
  createIdleFollowerState,
  normalizeFollowerState,
  type FollowerState,
} from "../../../shared/follower";

export interface FollowerRuntimeServiceShape {
  readonly getWindowState: (gameWindowId: number) => FollowerState;
  readonly setWindowState: (
    gameWindowId: number,
    state: FollowerState,
  ) => FollowerState;
  readonly deleteWindowState: (gameWindowId: number) => void;
}

export class FollowerRuntimeService extends ServiceMap.Service<
  FollowerRuntimeService,
  FollowerRuntimeServiceShape
>()("main/ipc/runtime/FollowerRuntimeService") {}

export const FollowerRuntimeServiceLive = Layer.effect(FollowerRuntimeService)(
  Effect.gen(function* () {
    const states = new Map<number, FollowerState>();
    const stateCleanupWindowIds = new Set<number>();

    const deleteWindowState = (gameWindowId: number): void => {
      states.delete(gameWindowId);
      stateCleanupWindowIds.delete(gameWindowId);
    };

    const trackWindowState = (gameWindowId: number): void => {
      if (stateCleanupWindowIds.has(gameWindowId)) {
        return;
      }

      const window = BrowserWindow.fromId(gameWindowId);
      if (!window || window.isDestroyed()) {
        deleteWindowState(gameWindowId);
        return;
      }

      stateCleanupWindowIds.add(gameWindowId);
      window.once("closed", () => {
        deleteWindowState(gameWindowId);
      });
    };

    const getWindowState = (gameWindowId: number): FollowerState =>
      states.get(gameWindowId) ?? createIdleFollowerState();

    const setWindowState = (
      gameWindowId: number,
      state: FollowerState,
    ): FollowerState => {
      const normalized = normalizeFollowerState(state);
      states.set(gameWindowId, normalized);
      trackWindowState(gameWindowId);
      return normalized;
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        states.clear();
        stateCleanupWindowIds.clear();
      }),
    );

    return {
      getWindowState,
      setWindowState,
      deleteWindowState,
    };
  }),
);
