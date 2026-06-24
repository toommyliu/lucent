import { Schema } from "effect";

import type {
  IpcEventDescriptor,
  IpcEventPayload,
  IpcInvokeDescriptor,
  IpcInvokeEnvelope,
  IpcInvokePayload,
  IpcInvokeResult,
} from "../shared/ipc";

export type IpcInvokeTransport = (
  channel: string,
  payload: unknown,
) => Promise<IpcInvokeEnvelope<unknown>>;

export type IpcEventTransport = {
  readonly on: (
    channel: string,
    listener: (rawPayload: unknown) => void,
  ) => void;
  readonly removeListener: (
    channel: string,
    listener: (rawPayload: unknown) => void,
  ) => void;
};

export class DesktopBridgeError extends Error {
  readonly code: string;
  readonly channel?: string;

  constructor(error: {
    readonly channel?: string;
    readonly code: string;
    readonly message: string;
  }) {
    super(error.message);
    this.name = "DesktopBridgeError";
    this.code = error.code;
    if (error.channel !== undefined) {
      this.channel = error.channel;
    }
  }
}

export const createInvoke =
  (transport: IpcInvokeTransport) =>
  async <Descriptor extends IpcInvokeDescriptor<unknown, unknown>>(
    descriptor: Descriptor,
    payload: IpcInvokePayload<Descriptor>,
  ): Promise<IpcInvokeResult<Descriptor>> => {
    const encodedPayload = Schema.encodeUnknownSync(
      descriptor.payload as unknown as Schema.Encoder<unknown>,
    )(payload);
    const envelope = await transport(descriptor.channel, encodedPayload);
    if (!envelope.ok) {
      throw new DesktopBridgeError(envelope.error);
    }
    return Schema.decodeUnknownSync(
      descriptor.result as unknown as Schema.Decoder<
        IpcInvokeResult<Descriptor>
      >,
    )(envelope.value);
  };

export const createSubscribe =
  (transport: IpcEventTransport) =>
  <Descriptor extends IpcEventDescriptor<unknown>>(
    descriptor: Descriptor,
    listener: (payload: IpcEventPayload<Descriptor>) => void,
  ): (() => void) => {
    const subscription = (rawPayload: unknown): void => {
      try {
        listener(
          Schema.decodeUnknownSync(
            descriptor.payload as unknown as Schema.Decoder<
              IpcEventPayload<Descriptor>
            >,
          )(rawPayload),
        );
      } catch (cause) {
        console.error(`Failed to decode ${descriptor.name} event`, cause);
      }
    };

    transport.on(descriptor.channel, subscription);
    return () => {
      transport.removeListener(descriptor.channel, subscription);
    };
  };
