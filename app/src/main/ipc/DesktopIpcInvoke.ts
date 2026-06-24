import { Cause, Effect, Schema } from "effect";

import {
  type IpcBridgeError,
  type IpcInvokeDescriptor,
  type IpcInvokeEnvelope,
  type IpcInvokePayload,
  type IpcInvokeResult,
} from "../../shared/ipc";

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return typeof cause === "string" && cause.length > 0
    ? cause
    : "IPC request failed.";
};

const bridgeError = (
  channel: string,
  code: string,
  cause: unknown,
): IpcBridgeError => ({
  channel,
  code,
  message: Cause.isCause(cause) ? Cause.pretty(cause) : errorMessage(cause),
});

export const createDesktopIpcInvokeHandler = <
  Descriptor extends IpcInvokeDescriptor<unknown, unknown>,
  Event,
>(
  descriptor: Descriptor,
  handler: (
    payload: IpcInvokePayload<Descriptor>,
    event: Event,
  ) => Effect.Effect<IpcInvokeResult<Descriptor>, unknown, never>,
  runPromise: <A>(effect: Effect.Effect<A, never, never>) => Promise<A>,
): ((
  event: Event,
  rawPayload: unknown,
) => Promise<IpcInvokeEnvelope<unknown>>) => {
  const decodePayload = Schema.decodeUnknownEffect(
    descriptor.payload as unknown as Schema.Decoder<
      IpcInvokePayload<Descriptor>
    >,
    { onExcessProperty: "error" },
  );
  const encodeResult = Schema.encodeUnknownEffect(
    descriptor.result as unknown as Schema.Encoder<unknown>,
  );

  return (event, rawPayload) => {
    const effect = Effect.gen(function* () {
      const payload = yield* decodePayload(rawPayload);
      const result = yield* handler(payload, event);
      const encoded = yield* encodeResult(result);
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
