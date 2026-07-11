import { Effect, Fiber, Stream } from "effect";

import type { GatewayService } from "../bridge/Gateway";
import { matchesEvent, type EventSelector } from "../contract/Event";
import type { Wait } from "./Wait";

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

  return {
    on: (
      selector: EventSelector | undefined,
      handler: (
        event: import("../contract/Event").Event,
      ) => Effect.Effect<void>,
    ) =>
      stream(selector).pipe(
        Stream.runForEach(handler),
        Effect.forkIn(scope),
        Effect.map((fiber) => () => {
          runFork(Fiber.interrupt(fiber));
        }),
      ),
    once: wait.forEvent,
    stream,
  };
});

export type Events = Effect.Success<ReturnType<typeof makeEvents>>;
