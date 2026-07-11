import { Effect, Fiber, Stream } from "effect";

import type { GatewayService } from "../bridge/Gateway";
import { matchesEvent, type EventSelector } from "../contract/Event";
import type { Wait } from "./Wait";
import type { Event } from "../contract/Event";

export const makeEvents = Effect.fnUntraced(function* (
  gateway: GatewayService,
  wait: Wait,
) {
  const scope = yield* Effect.scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const stream = (selector?: EventSelector) =>
    gateway.events.pipe(
      Stream.filter((event) => matchesEvent(event, selector)),
    );

  const on = (
    selector: EventSelector | undefined,
    handler: (event: Event) => Effect.Effect<void, unknown, never>,
  ) =>
    stream(selector).pipe(
      Stream.runForEach(handler),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    );

  const once = wait.forEvent;

  return {
    on,
    once,
    stream,
  };
});

export type Events = Effect.Success<ReturnType<typeof makeEvents>>;
