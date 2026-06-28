import { Context, Effect, Layer } from "effect";

import { bridgeFallbacks } from "../BridgeFallbacks";

type SwfMethod = keyof Window["swf"];

export interface SwfBridgeFailure {
  readonly args: readonly unknown[];
  readonly cause: unknown;
  readonly method: string;
}

export interface SwfBridgeShape {
  readonly call: <Method extends SwfMethod>(
    method: Method,
    args?: Parameters<Window["swf"][Method]>,
  ) => Effect.Effect<ReturnType<Window["swf"][Method]>>;
  readonly callGameFunction: (
    path: string,
    ...args: readonly unknown[]
  ) => Effect.Effect<unknown>;
  readonly readJson: (
    method: SwfMethod,
    args?: readonly unknown[],
  ) => Effect.Effect<unknown>;
}

export class SwfBridge extends Context.Service<SwfBridge, SwfBridgeShape>()(
  "lucent/game/flash/SwfBridge",
) {}

const warnBridgeFailure = (failure: SwfBridgeFailure): void => {
  console.warn("[flash:bridge]", "call failed; using fallback", {
    args: failure.args,
    cause: failure.cause,
    method: failure.method,
  });
};

const parseJsonFallback = (value: unknown): Effect.Effect<unknown> => {
  if (typeof value !== "string") {
    return Effect.succeed(value);
  }

  return Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)));
};

const makeSwfBridge = (): SwfBridgeShape => {
  const call: SwfBridgeShape["call"] = (method, args) =>
    Effect.try({
      try: () => {
        const callArgs = (args ?? []) as Parameters<
          Window["swf"][typeof method]
        >;
        const swf = window.swf;
        const target = swf[method];
        if (typeof target !== "function") {
          throw new Error(`Missing SWF callback: ${String(method)}`);
        }

        const invoke = target as (
          ...innerArgs: Parameters<Window["swf"][typeof method]>
        ) => ReturnType<Window["swf"][typeof method]>;
        return invoke(...callArgs);
      },
      catch: (cause): SwfBridgeFailure => ({
        args: (args ?? []) as readonly unknown[],
        cause,
        method: String(method),
      }),
    }).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          warnBridgeFailure({
            args: failure.args,
            cause: failure.cause,
            method: failure.method,
          });

          const fallback = bridgeFallbacks[method] as () => ReturnType<
            Window["swf"][typeof method]
          >;
          return fallback();
        }),
      ),
    );

  const callGameFunction: SwfBridgeShape["callGameFunction"] = (
    path,
    ...args
  ) =>
    (args.length === 0
      ? call("flash.callGameFunction0", [path])
      : call("flash.callGameFunction", [path, ...args])
    ).pipe(Effect.flatMap(parseJsonFallback));

  const readJson: SwfBridgeShape["readJson"] = (method, args) =>
    call(method, args as Parameters<Window["swf"][typeof method]>).pipe(
      Effect.flatMap(parseJsonFallback),
    );

  return {
    call,
    callGameFunction,
    readJson,
  };
};

export const layer = Layer.succeed(SwfBridge, SwfBridge.of(makeSwfBridge()));
