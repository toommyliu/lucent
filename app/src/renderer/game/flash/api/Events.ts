import { Context, Effect, Layer } from "effect";

import type { EventSelector, FlashEvent, WaitOptions } from "../Types";
import { FlashProtocol } from "../protocol/FlashProtocol";

export type FlashEventHandler = (event: FlashEvent) => Effect.Effect<void>;

export interface EventsApiShape {
  readonly on: (
    selector: EventSelector | undefined,
    handler: FlashEventHandler,
  ) => Effect.Effect<() => void>;
  readonly once: (
    selector?: EventSelector,
    options?: WaitOptions,
  ) => Effect.Effect<FlashEvent | null>;
}

export class EventsApi extends Context.Service<EventsApi, EventsApiShape>()(
  "lucent/game/flash/api/Events",
) {}

export const layer = Layer.effect(
  EventsApi,
  Effect.gen(function* () {
    const protocol = yield* FlashProtocol;

    return EventsApi.of({
      on: protocol.onEvent,
      once: (selector, options) =>
        protocol.onceEvent(
          selector,
          options?.timeout === undefined
            ? undefined
            : { timeout: options.timeout },
        ),
    });
  }),
);
