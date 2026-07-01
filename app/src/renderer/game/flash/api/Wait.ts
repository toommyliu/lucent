import { Context, Effect, Layer, Option, Schedule } from "effect";
import type { Duration } from "effect";

import type {
  EventSelector,
  FlashEvent,
  FlashPacket,
  PacketSelector,
  WaitOptions,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import { FlashProtocol } from "../protocol/FlashProtocol";

export interface WaitApiShape {
  readonly forEvent: (
    selector?: EventSelector,
    options?: WaitOptions,
  ) => Effect.Effect<FlashEvent | null>;
  readonly forGameAction: (
    action: string,
    options?: WaitOptions | Duration.Input,
  ) => Effect.Effect<boolean>;
  readonly forPacket: (
    selector?: PacketSelector,
    options?: WaitOptions,
  ) => Effect.Effect<FlashPacket | null>;
  readonly isGameActionAvailable: (action: string) => Effect.Effect<boolean>;
  readonly until: (
    condition: Effect.Effect<boolean>,
    options?: WaitOptions,
  ) => Effect.Effect<boolean>;
  readonly untilSome: <A>(
    condition: Effect.Effect<Option.Option<A>>,
    options?: WaitOptions,
  ) => Effect.Effect<A | null>;
}

export class WaitApi extends Context.Service<WaitApi, WaitApiShape>()(
  "lucent/game/flash/api/Wait",
) {}

const isWaitOptions = (
  options: WaitOptions | Duration.Input,
): options is WaitOptions =>
  typeof options === "object" &&
  !Array.isArray(options) &&
  ("timeout" in options || "interval" in options);

const normalizeOptions = (
  options: WaitOptions | Duration.Input | undefined,
): WaitOptions => {
  if (options === undefined) {
    return {};
  }

  if (isWaitOptions(options)) {
    return options;
  }

  return { timeout: options };
};

const until: WaitApiShape["until"] = (condition, options) => {
  const awaited = Effect.repeat(condition, {
    schedule: Schedule.spaced(options?.interval ?? "100 millis"),
    until: (done) => done,
  }).pipe(Effect.as(true));

  if (options?.timeout === undefined) {
    return awaited;
  }

  return awaited.pipe(
    Effect.timeoutOption(options.timeout),
    Effect.map(Option.isSome),
  );
};

const untilSome: WaitApiShape["untilSome"] = (condition, options) =>
  Effect.gen(function* () {
    const awaited = Effect.repeat(condition, {
      schedule: Schedule.spaced(options?.interval ?? "100 millis"),
      until: Option.isSome,
    });

    if (options?.timeout === undefined) {
      const result = yield* awaited;
      return Option.isSome(result) ? result.value : null;
    }

    const result = yield* awaited.pipe(Effect.timeoutOption(options.timeout));
    return Option.isSome(result) && Option.isSome(result.value)
      ? result.value.value
      : null;
  });

export const layer = Layer.effect(
  WaitApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const protocol = yield* FlashProtocol;

    const isGameActionAvailable: WaitApiShape["isGameActionAvailable"] = (
      action,
    ) => bridge.call("world.isActionAvailable", [action]);

    return WaitApi.of({
      forEvent: (selector, options) =>
        protocol.onceEvent(
          selector,
          options?.timeout === undefined
            ? undefined
            : { timeout: options.timeout },
        ),
      forGameAction: (action, options) => {
        const normalized = normalizeOptions(options);
        return until(
          isGameActionAvailable(action),
          normalized.interval === undefined
            ? { timeout: normalized.timeout ?? "2 seconds" }
            : {
                interval: normalized.interval,
                timeout: normalized.timeout ?? "2 seconds",
              },
        );
      },
      forPacket: (selector, options) =>
        protocol.oncePacket(
          selector,
          options?.timeout === undefined
            ? undefined
            : { timeout: options.timeout },
        ),
      isGameActionAvailable,
      until,
      untilSome,
    });
  }),
);
