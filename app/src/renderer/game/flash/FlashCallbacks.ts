import { Context, Effect, Layer, Queue } from "effect";

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

type WindowCallback = (...args: readonly unknown[]) => void;

export interface FlashCallbacksShape {
  readonly publish: (event: FlashCallback) => Effect.Effect<void>;
  readonly take: () => Effect.Effect<FlashCallback>;
}

export class FlashCallbacks extends Context.Service<
  FlashCallbacks,
  FlashCallbacksShape
>()("lucent/game/flash/FlashCallbacks") {}

const normalizeString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const normalizeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asWindowCallback = (value: unknown): WindowCallback | undefined =>
  typeof value === "function" ? (value as WindowCallback) : undefined;

export const layer = Layer.effect(
  FlashCallbacks,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<FlashCallback>();
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));

    const publish = (event: FlashCallback) =>
      Queue.offer(queue, event).pipe(
        Effect.flatMap((enqueued) =>
          enqueued
            ? Effect.void
            : Effect.logWarning({
                message: "failed to enqueue Flash callback",
                type: event.type,
              }),
        ),
      );

    const publishUnsafe = (event: FlashCallback): void => {
      if (Queue.offerUnsafe(queue, event)) {
        return;
      }

      console.error("[flash callbacks] failed to enqueue callback", {
        type: event.type,
      });
    };

    const install = (
      key: CallbackKey,
      toEvent: (...args: readonly unknown[]) => FlashCallback | null,
    ): Effect.Effect<() => void> =>
      Effect.sync(() => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(window, key);
        let external = asWindowCallback(window[key]);

        const next = (...args: readonly unknown[]): void => {
          const event = toEvent(...args);
          if (event !== null) {
            // Enqueue first so a re-entrant or failing chained callback cannot reorder or drop it.
            publishUnsafe(event);
          }

          try {
            external?.(...args);
          } catch (cause) {
            console.error("[flash callbacks] chained callback failed", {
              cause,
              key,
            });
          }
        };

        if (originalDescriptor?.configurable === false) {
          (window as Record<CallbackKey, unknown>)[key] = next;
          return () => {
            if (window[key] === next) {
              (window as Record<CallbackKey, unknown>)[key] = external;
            }
          };
        }

        const get = (): WindowCallback => next;
        const set = (value: unknown): void => {
          external = value === next ? undefined : asWindowCallback(value);
        };

        Object.defineProperty(window, key, {
          configurable: true,
          enumerable: originalDescriptor?.enumerable ?? true,
          get,
          set,
        });

        return () => {
          const currentDescriptor = Object.getOwnPropertyDescriptor(
            window,
            key,
          );
          if (currentDescriptor?.get !== get || currentDescriptor.set !== set) {
            return;
          }

          if (originalDescriptor === undefined) {
            delete (window as Record<CallbackKey, unknown>)[key];
          } else {
            Object.defineProperty(window, key, originalDescriptor);
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
      take: () => Queue.take(queue),
    });
  }),
);
