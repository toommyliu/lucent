import { Effect, Option, PubSub, Schedule, Scope } from "effect";
import type { Duration } from "effect";

import {
  matchesEvent,
  type Event,
  type EventSelector,
} from "../contract/Event";
import {
  matchesPacket,
  type Packet,
  type PacketSelector,
  type WaitOptions,
} from "../contract/Packet";

interface WaitSource {
  readonly subscribeEvents: Effect.Effect<
    PubSub.Subscription<Event>,
    never,
    Scope.Scope
  >;
  readonly subscribePackets: Effect.Effect<
    PubSub.Subscription<Packet>,
    never,
    Scope.Scope
  >;
}

export interface TriggeredWaitOptions<E = never, R = never> extends Pick<
  WaitOptions,
  "timeout"
> {
  readonly trigger?: Effect.Effect<boolean, E, R>;
}

const takeMatching = <A>(
  subscription: PubSub.Subscription<A>,
  matches: (value: A) => boolean,
): Effect.Effect<A> =>
  Effect.gen(function* () {
    while (true) {
      const value = yield* PubSub.take(subscription);
      if (matches(value)) return value;
    }
  });

const withTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  timeout: Duration.Input | undefined,
): Effect.Effect<A | null, E, R> =>
  timeout === undefined
    ? effect.pipe(Effect.map((value): A | null => value))
    : effect.pipe(Effect.timeoutOption(timeout), Effect.map(Option.getOrNull));

export const makeWait = (source: WaitSource) => ({
  forEvent: <E = never, R = never>(
    selector?: EventSelector,
    options?: TriggeredWaitOptions<E, R>,
  ): Effect.Effect<Event | null, E, R> =>
    Effect.scoped(
      Effect.gen(function* () {
        const subscription = yield* source.subscribeEvents;
        if (options?.trigger !== undefined) {
          const responseExpected = yield* options.trigger;
          if (!responseExpected) return null;
        }
        return yield* withTimeout(
          takeMatching(subscription, (event) => matchesEvent(event, selector)),
          options?.timeout,
        );
      }),
    ),
  forPacket: <E = never, R = never>(
    selector?: PacketSelector,
    options?: TriggeredWaitOptions<E, R>,
  ): Effect.Effect<Packet | null, E, R> =>
    Effect.scoped(
      Effect.gen(function* () {
        const subscription = yield* source.subscribePackets;
        if (options?.trigger !== undefined) {
          const responseExpected = yield* options.trigger;
          if (!responseExpected) return null;
        }
        return yield* withTimeout(
          takeMatching(subscription, (packet) =>
            matchesPacket(packet, selector),
          ),
          options?.timeout,
        );
      }),
    ),
  until: (
    condition: Effect.Effect<boolean>,
    options?: WaitOptions,
  ): Effect.Effect<boolean> => {
    const awaited = Effect.repeat(condition, {
      schedule: Schedule.spaced(options?.interval ?? "100 millis"),
      until: Boolean,
    }).pipe(Effect.as(true));
    return options?.timeout === undefined
      ? awaited
      : awaited.pipe(
          Effect.timeoutOption(options.timeout),
          Effect.map(Option.isSome),
        );
  },
  untilSome: <A>(
    condition: Effect.Effect<Option.Option<A>>,
    options?: WaitOptions,
  ): Effect.Effect<A | null> => {
    const awaited = Effect.repeat(condition, {
      schedule: Schedule.spaced(options?.interval ?? "100 millis"),
      until: Option.isSome,
    });
    return options?.timeout === undefined
      ? awaited.pipe(Effect.map(Option.getOrNull))
      : awaited.pipe(
          Effect.timeoutOption(options.timeout),
          Effect.map(Option.flatten),
          Effect.map(Option.getOrNull),
        );
  },
});

export type Wait = ReturnType<typeof makeWait>;
