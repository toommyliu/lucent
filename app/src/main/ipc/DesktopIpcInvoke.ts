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
  traceRendererId?: (event: Event) => number,
): ((
  event: Event,
  rawPayload: unknown,
) => Promise<IpcInvokeEnvelope<unknown>>) => {
  const decodeTraceEnvelope = Schema.decodeUnknownEffect(
    DesktopIpcTraceEnvelopeSchema,
  );
  const stage = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
    traceRendererId === undefined
      ? effect
      : effect.pipe(
          Effect.withSpan(`ipc.${name} ${descriptor.name}`, undefined, {
            captureStackTrace: false,
          }),
        );
  const invoke = (event: Event, rawPayload: unknown) =>
    Effect.gen(function* () {
      const payload = yield* stage(
        "decode",
        descriptor.decodePayloadEffect(rawPayload),
      );
      const result = yield* stage("handler", handler(payload, event));
      const encoded = yield* stage(
        "encode",
        descriptor.encodeResultEffect(result),
      );
      if (traceRendererId !== undefined && descriptor.trace === "full") {
        yield* Effect.annotateCurrentSpan("ipc.result", encoded);
      }
      return { ok: true, value: encoded } satisfies IpcInvokeEnvelope<unknown>;
    });

  return (event, rawPayload) => {
    const request =
      traceRendererId === undefined
        ? invoke(event, rawPayload)
        : decodeTraceEnvelope(rawPayload).pipe(
            Effect.flatMap(({ payload, trace }) =>
              invoke(event, payload).pipe(
                Effect.withSpan(
                  `ipc.main ${descriptor.name}`,
                  {
                    attributes: {
                      "ipc.channel": descriptor.channel,
                      "ipc.name": descriptor.name,
                      "renderer.id": traceRendererId(event),
                      ...(descriptor.trace === "full"
                        ? { "ipc.payload": payload }
                        : {}),
                    },
                    kind: "server",
                    parent: Tracer.externalSpan(trace),
                  },
                  { captureStackTrace: false },
                ),
              ),
            ),
          );

    return runPromise(
      request.pipe(
        Effect.catchCause((cause) =>
          Effect.succeed({
            ok: false,
            error: bridgeError(descriptor.channel, "IPC_HANDLER_FAILED", cause),
          } satisfies IpcInvokeEnvelope<unknown>),
        ),
      ),
    );
  };
};
