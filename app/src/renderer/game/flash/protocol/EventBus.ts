import { Deferred, Effect, Option } from "effect";
import type { WaitOptions } from "../Types";

type EffectHandler<A> = (value: A) => Effect.Effect<void>;

export interface HandlerBus<A, Selector> {
  readonly dispatch: (value: A) => Effect.Effect<void>;
  readonly on: (
    selector: Selector | undefined,
    handler: EffectHandler<A>,
  ) => Effect.Effect<() => void>;
  readonly once: (
    selector: Selector | undefined,
    options?: Pick<WaitOptions, "timeout">,
  ) => Effect.Effect<A | null>;
}

export const makeHandlerBus = <A, Selector>(
  matches: (value: A, selector: Selector | undefined) => boolean,
  runFork: (effect: Effect.Effect<void>) => unknown,
): HandlerBus<A, Selector> => {
  let nextId = 0;
  const handlers = new Map<
    number,
    {
      readonly handler: EffectHandler<A>;
      readonly selector: Selector | undefined;
    }
  >();

  const on: HandlerBus<A, Selector>["on"] = (selector, handler) =>
    Effect.sync(() => {
      const id = nextId;
      nextId += 1;
      handlers.set(id, { handler, selector });
      return () => {
        handlers.delete(id);
      };
    });

  const dispatch: HandlerBus<A, Selector>["dispatch"] = (value) =>
    Effect.sync(() => {
      for (const entry of Array.from(handlers.values())) {
        if (!matches(value, entry.selector)) {
          continue;
        }

        runFork(
          entry.handler(value).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning({
                cause,
                message: "flash protocol handler failed",
              }),
            ),
          ),
        );
      }
    });

  const once: HandlerBus<A, Selector>["once"] = (selector, options) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<A>();
      const dispose = yield* on(selector, (value) =>
        Deferred.succeed(deferred, value).pipe(Effect.asVoid),
      );

      if (options?.timeout === undefined) {
        return yield* Deferred.await(deferred).pipe(
          Effect.ensuring(Effect.sync(dispose)),
        );
      }

      const result = yield* Deferred.await(deferred).pipe(
        Effect.timeoutOption(options.timeout),
        Effect.ensuring(Effect.sync(dispose)),
      );
      return Option.isSome(result) ? result.value : null;
    });

  return {
    dispatch,
    on,
    once,
  };
};
