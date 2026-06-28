import { Context, Effect, Layer, PubSub } from "effect";
import type { Scope } from "effect";

export type FlashCallback =
  | {
      readonly type: "connection";
      readonly status: string;
    }
  | {
      readonly type: "debug";
      readonly message: string;
    }
  | {
      readonly type: "extension-packet";
      readonly raw: string;
    }
  | {
      readonly type: "loaded";
    }
  | {
      readonly type: "progress";
      readonly percent: number;
    }
  | {
      readonly type: "client-packet";
      readonly raw: string;
    }
  | {
      readonly type: "server-packet";
      readonly raw: string;
    };

type CallbackKey =
  | "onConnection"
  | "onDebug"
  | "onExtensionResponse"
  | "onLoaded"
  | "onProgress"
  | "packetFromClient"
  | "packetFromServer";

export interface FlashCallbacksShape {
  readonly publish: (event: FlashCallback) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<
    PubSub.Subscription<FlashCallback>,
    never,
    Scope.Scope
  >;
}

export class FlashCallbacks extends Context.Service<
  FlashCallbacks,
  FlashCallbacksShape
>()("lucent/game/flash/FlashCallbacks") {}

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const normalizeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const layer = Layer.effect(
  FlashCallbacks,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.sliding<FlashCallback>(1024);
    const runFork = Effect.runForkWith(yield* Effect.context<never>());

    const publish = (event: FlashCallback) =>
      PubSub.publish(pubsub, event).pipe(Effect.asVoid);

    const install = (
      key: CallbackKey,
      toEvent: (...args: readonly unknown[]) => FlashCallback | null,
    ): Effect.Effect<() => void> =>
      Effect.sync(() => {
        const previous = window[key] as
          | ((...args: readonly unknown[]) => void)
          | undefined;

        const next = (...args: readonly unknown[]): void => {
          previous?.(...args);
          const event = toEvent(...args);
          if (event === null) {
            return;
          }

          runFork(
            publish(event).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning({
                  cause,
                  message: "failed to publish Flash callback",
                  type: event.type,
                }),
              ),
            ),
          );
        };

        (window as Record<CallbackKey, unknown>)[key] = next;
        return () => {
          if (window[key] === next) {
            (window as Record<CallbackKey, unknown>)[key] = previous;
          }
        };
      });

    const disposers = yield* Effect.all([
      install("onConnection", (status) => {
        const text = normalizeString(status);
        return text === null ? null : { type: "connection", status: text };
      }),
      install("onDebug", (message) => {
        const text = normalizeString(message);
        return text === null ? null : { type: "debug", message: text };
      }),
      install("onExtensionResponse", (raw) => {
        const text = normalizeString(raw);
        return text === null ? null : { type: "extension-packet", raw: text };
      }),
      install("onLoaded", () => ({ type: "loaded" })),
      install("onProgress", (percent) => {
        const value = normalizeNumber(percent);
        return value === null ? null : { type: "progress", percent: value };
      }),
      install("packetFromClient", (raw) => {
        const text = normalizeString(raw);
        return text === null ? null : { type: "client-packet", raw: text };
      }),
      install("packetFromServer", (raw) => {
        const text = normalizeString(raw);
        return text === null ? null : { type: "server-packet", raw: text };
      }),
    ]);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const dispose of disposers) {
          dispose();
        }
      }),
    );

    return FlashCallbacks.of({
      publish,
      subscribe: PubSub.subscribe(pubsub),
    });
  }),
);
