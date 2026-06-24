import { Schema } from "effect";

export type IpcSchema<T> = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
  readonly Encoded: unknown;
  readonly Type: T;
};

export interface IpcInvokeDescriptor<Payload, Result> {
  readonly channel: string;
  readonly name: string;
  readonly payload: IpcSchema<Payload>;
  readonly result: IpcSchema<Result>;
}

export interface IpcEventDescriptor<Payload> {
  readonly channel: string;
  readonly name: string;
  readonly payload: IpcSchema<Payload>;
}

export type IpcInvokePayload<
  Descriptor extends IpcInvokeDescriptor<unknown, unknown>,
> =
  Descriptor extends IpcInvokeDescriptor<infer Payload, unknown>
    ? Payload
    : never;

export type IpcInvokeResult<
  Descriptor extends IpcInvokeDescriptor<unknown, unknown>,
> =
  Descriptor extends IpcInvokeDescriptor<unknown, infer Result>
    ? Result
    : never;

export type IpcEventPayload<Descriptor extends IpcEventDescriptor<unknown>> =
  Descriptor extends IpcEventDescriptor<infer Payload> ? Payload : never;

export interface IpcBridgeError {
  readonly channel?: string;
  readonly code: string;
  readonly message: string;
}

export type IpcInvokeEnvelope<Result> =
  | {
      readonly ok: true;
      readonly value: Result;
    }
  | {
      readonly error: IpcBridgeError;
      readonly ok: false;
    };

export const IpcBridgeErrorSchema = Schema.Struct({
  channel: Schema.optionalKey(Schema.String),
  code: Schema.String,
  message: Schema.String,
});

export const defineInvoke = <Payload, Result>(descriptor: {
  readonly channel: string;
  readonly name: string;
  readonly payload: IpcSchema<Payload>;
  readonly result: IpcSchema<Result>;
}): IpcInvokeDescriptor<Payload, Result> => descriptor;

export const defineEvent = <Payload>(descriptor: {
  readonly channel: string;
  readonly name: string;
  readonly payload: IpcSchema<Payload>;
}): IpcEventDescriptor<Payload> => descriptor;
