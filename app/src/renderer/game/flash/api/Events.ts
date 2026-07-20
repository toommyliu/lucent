import { Effect, Fiber, Stream } from "effect";

import type { GatewayService } from "../bridge/Gateway";
import {
  matchesEvent,
  type Event,
  type EventForSelector,
  type EventForType,
  type EventSelector,
  type EventSelectorForType,
  type EventType,
} from "../contract/Event";
import type { Wait } from "./Wait";

interface OnEvent {
  <const T extends EventType, E>(
    selector: EventSelectorForType<T>,
    handler: (event: EventForType<T>) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void>;
  <E>(
    selector: undefined,
    handler: (event: Event) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void>;
  <E>(
    selector: EventSelector | undefined,
    handler: (event: Event) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void>;
}

export const makeEvents = Effect.fnUntraced(function* (
  gateway: GatewayService,
  wait: Wait,
) {
  const scope = yield* Effect.scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const stream = <
    const S extends EventSelector | undefined = EventSelector | undefined,
  >(
    selector?: S,
  ) =>
    gateway.events.pipe(
      Stream.filter((event): event is EventForSelector<S> =>
        matchesEvent(event, selector),
      ),
    );

  const on = ((
    selector: EventSelector | undefined,
    handler: (event: Event) => Effect.Effect<void, unknown>,
  ) =>
    stream(selector).pipe(
      Stream.runForEach(handler),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    )) as OnEvent;

  const once = wait.forEvent;

  return {
    on,
    once,
    stream,
  };
});

export type Events = Effect.Success<ReturnType<typeof makeEvents>>;
