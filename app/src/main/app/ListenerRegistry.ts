import { Effect } from "effect";

export interface ListenerRegistry<Value> {
  readonly publish: (value: Value) => Effect.Effect<void>;
  readonly subscribe: (
    listener: (value: Value) => void,
  ) => Effect.Effect<() => void>;
}

export const makeListenerRegistry = <Value>(): ListenerRegistry<Value> => {
  const listeners = new Set<(value: Value) => void>();

  const publish: ListenerRegistry<Value>["publish"] = (value) =>
    Effect.forEach(
      [...listeners],
      (listener) =>
        Effect.sync(() => listener(value)).pipe(
          Effect.catchCause(() => Effect.void),
        ),
      { discard: true },
    );

  const subscribe: ListenerRegistry<Value>["subscribe"] = (listener) =>
    Effect.sync(() => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });

  return {
    publish,
    subscribe,
  };
};
