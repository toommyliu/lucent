import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import {
  DesktopIpcTraceEnvelopeSchema,
  type IpcBridgeError,
  type IpcInvokeDescriptor,
  type IpcInvokeEnvelope,
} from "../../shared/ipc";

const errorMessage = (cause: unknown, fallback: string): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return typeof cause === "string" && cause.length > 0 ? cause : fallback;
};

const bridgeError = (
  channel: string,
  code: string,
  cause: unknown,
): IpcBridgeError => {
  const fallback = `IPC request failed on channel "${channel}".`;
  return {
    channel,
    code,
    message: Cause.isCause(cause)
      ? errorMessage(Cause.squash(cause), fallback)
      : errorMessage(cause, fallback),
  };
};

export const createDesktopIpcInvokeHandler = <
  Payload,
  Result,
  Event,
  HandlerContext,
>(
  descriptor: IpcInvokeDescriptor<Payload, Result>,
  handler: (
    payload: Payload,
    event: Event,
  ) => Effect.Effect<Result, unknown, HandlerContext>,
  runPromise: <A, E>(effect: Effect.Effect<A, E, HandlerContext>) => Promise<A>,
): ((
  event: Event,
  rawPayload: unknown,
) => Promise<IpcInvokeEnvelope<unknown>>) => {
  return (event, rawPayload) => {
    const effect = Effect.gen(function* () {
      const payload = yield* descriptor.decodePayloadEffect(rawPayload);
      const result = yield* handler(payload, event);
      const encoded = yield* descriptor.encodeResultEffect(result);
      return {
        ok: true,
        value: encoded,
      } satisfies IpcInvokeEnvelope<unknown>;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed({
          ok: false,
          error: bridgeError(descriptor.channel, "IPC_HANDLER_FAILED", cause),
        } satisfies IpcInvokeEnvelope<unknown>),
      ),
    );

    return runPromise(effect);
  };
};

export const createObservedDesktopIpcInvokeHandler = <
  Payload,
  Result,
  Event,
  HandlerContext,
>(
  descriptor: IpcInvokeDescriptor<Payload, Result>,
  handler: (
    payload: Payload,
    event: Event,
  ) => Effect.Effect<Result, unknown, HandlerContext>,
  runPromise: <A, E>(effect: Effect.Effect<A, E, HandlerContext>) => Promise<A>,
  rendererId: (event: Event) => number,
): ((
  event: Event,
  rawPayload: unknown,
) => Promise<IpcInvokeEnvelope<unknown>>) => {
  const decodeTraceEnvelope = Schema.decodeUnknownEffect(
    DesktopIpcTraceEnvelopeSchema,
  );

  return (event, rawPayload) => {
    const effect = decodeTraceEnvelope(rawPayload).pipe(
      Effect.flatMap(({ payload: rawIpcPayload, trace }) =>
        Effect.gen(function* () {
          const payload = yield* descriptor
            .decodePayloadEffect(rawIpcPayload)
            .pipe(
              Effect.withSpan(`ipc.decode ${descriptor.name}`, undefined, {
                captureStackTrace: false,
              }),
            );
          const result = yield* handler(payload, event).pipe(
            Effect.withSpan(`ipc.handler ${descriptor.name}`, undefined, {
              captureStackTrace: false,
            }),
          );
          const encoded = yield* descriptor.encodeResultEffect(result).pipe(
            Effect.withSpan(`ipc.encode ${descriptor.name}`, undefined, {
              captureStackTrace: false,
            }),
          );
          yield* Effect.annotateCurrentSpan("ipc.result", encoded);
          return {
            ok: true,
            value: encoded,
          } satisfies IpcInvokeEnvelope<unknown>;
        }).pipe(
          Effect.withSpan(
            `ipc.main ${descriptor.name}`,
            {
              attributes: {
                "ipc.channel": descriptor.channel,
                "ipc.name": descriptor.name,
                "ipc.payload": rawIpcPayload,
                "renderer.id": rendererId(event),
              },
              kind: "server",
              parent: Tracer.externalSpan(trace),
            },
            { captureStackTrace: false },
          ),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.succeed({
          ok: false,
          error: bridgeError(descriptor.channel, "IPC_HANDLER_FAILED", cause),
        } satisfies IpcInvokeEnvelope<unknown>),
      ),
    );

    return runPromise(effect);
  };
};
