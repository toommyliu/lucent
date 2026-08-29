import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import type { GatewayService } from "../bridge/Gateway";
import {
  isProjectionEvent,
  matchesEvent,
  type Event,
  type EventForSelector,
  type EventForType,
  type EventSelector,
  type EventSelectorForType,
  type EventType,
  type ProjectionEvent,
  type ProjectionEventSelector,
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

type ProjectionEventType = ProjectionEvent["type"];
type ProjectionEventForType<T extends ProjectionEventType> = Extract<
  ProjectionEvent,
  { readonly type: T }
>;
type ProjectionEventSelectorForType<T extends ProjectionEventType> =
  ProjectionEventSelector & { readonly type: T };

interface OnProjectionEvent {
  <const T extends ProjectionEventType, E>(
    selector: ProjectionEventSelectorForType<T>,
    handler: (event: ProjectionEventForType<T>) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void>;
  <E>(
    selector: undefined,
    handler: (event: ProjectionEvent) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void>;
  <E>(
    selector: ProjectionEventSelector | undefined,
    handler: (event: ProjectionEvent) => Effect.Effect<void, E>,
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

  const onProjection = ((
    selector: ProjectionEventSelector | undefined,
    handler: (event: ProjectionEvent) => Effect.Effect<void, unknown>,
  ) =>
    on(selector, (event) =>
      isProjectionEvent(event) ? handler(event) : Effect.void,
    )) as OnProjectionEvent;

  const once = wait.forEvent;
  const onceProjection = wait.forProjectionEvent;

  return {
    on,
    onProjection,
    once,
    onceProjection,
    stream,
  };
});

export type Events = Effect.Success<ReturnType<typeof makeEvents>>;
