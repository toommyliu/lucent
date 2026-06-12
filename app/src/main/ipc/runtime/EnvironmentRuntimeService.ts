import { BrowserWindow } from "electron";
import { Effect, Layer, ServiceMap } from "effect";
import {
  createEmptyEnvironmentState,
  normalizeEnvironmentState,
  type EnvironmentState,
} from "../../../shared/environment";

export interface EnvironmentRuntimeServiceShape {
  readonly getWindowState: (gameWindowId: number) => EnvironmentState;
  readonly setWindowState: (
    gameWindowId: number,
    state: EnvironmentState,
  ) => EnvironmentState;
  readonly deleteWindowState: (gameWindowId: number) => void;
}

export class EnvironmentRuntimeService extends ServiceMap.Service<
  EnvironmentRuntimeService,
  EnvironmentRuntimeServiceShape
>()("main/ipc/runtime/EnvironmentRuntimeService") {}

export const EnvironmentRuntimeServiceLive = Layer.effect(
  EnvironmentRuntimeService,
)(
  Effect.gen(function* () {
    const states = new Map<number, EnvironmentState>();
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

    const getWindowState = (gameWindowId: number): EnvironmentState => {
      const existing = states.get(gameWindowId);
      if (existing) {
        return existing;
      }

      const empty = createEmptyEnvironmentState();
      states.set(gameWindowId, empty);
      trackWindowState(gameWindowId);
      return empty;
    };

    const setWindowState = (
      gameWindowId: number,
      state: EnvironmentState,
    ): EnvironmentState => {
      const normalized = normalizeEnvironmentState(state);
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
