import { Effect } from "effect";

export interface StateSubscriptionOptions {
  readonly emitCurrent?: boolean;
}

export type StateDisposer = () => void;

export const makeStateListeners = <State>(label: string) => {
  const listeners = new Set<(state: State) => void>();

  const remove = (listener: (state: State) => void) =>
    Effect.sync(() => {
      listeners.delete(listener);
    });

  const emit = (state: State) =>
    Effect.forEach(
      Array.from(listeners),
      (listener, listenerIndex) =>
        Effect.sync(() => listener(state)).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* remove(listener);
              yield* Effect.logError({
                cause,
                listenerIndex,
                message: `${label} state listener failed; removed`,
              });
            }),
          ),
        ),
      { discard: true },
    );

  const on = (
    getState: Effect.Effect<State>,
    listener: (state: State) => void,
    options?: StateSubscriptionOptions,
  ): Effect.Effect<StateDisposer> =>
    Effect.gen(function* () {
      listeners.add(listener);

      if (options?.emitCurrent ?? true) {
        const state = yield* getState;
        yield* Effect.sync(() => listener(state)).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* remove(listener);
              yield* Effect.logError({
                cause,
                message: `${label} current-state listener failed; removed`,
              });
            }),
          ),
        );
      }

      return () => {
        listeners.delete(listener);
      };
    });

  return {
    emit,
    on,
  };
};
