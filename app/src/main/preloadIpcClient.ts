import type {
  DesktopIpcTraceEnvelope,
  DesktopTraceContext,
  IpcEventDescriptor,
  IpcInvokeDescriptor,
  IpcInvokeEnvelope,
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

export type IpcInvokeObservationStage =
  | "decode"
  | "encode"
  | "main"
  | "transport";

export interface IpcInvokeObservation {
  readonly cause?: unknown;
  readonly channel: string;
  readonly durationMs: number;
  readonly endTimeUnixNano: string;
  readonly name: string;
  readonly outcome: "failure" | "success";
  readonly startTimeUnixNano: string;
  readonly stage?: IpcInvokeObservationStage;
  readonly trace: DesktopTraceContext;
}

export type IpcInvokeObserver = (observation: IpcInvokeObservation) => void;

const roundedDuration = (durationMs: number): number =>
  Math.round(durationMs * 1000) / 1000;

const randomHex = (byteLength: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(byteLength)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const makeTraceContext = (): DesktopTraceContext => ({
  sampled: true,
  spanId: randomHex(8),
  traceId: randomHex(16),
});

const unixTimeNanos = (): bigint =>
  BigInt(Math.round((performance.timeOrigin + performance.now()) * 1_000_000));

const reportSafely = (
  observer: IpcInvokeObserver,
  observation: IpcInvokeObservation,
): void => {
  try {
    observer(observation);
  } catch {}
};

export const createInvoke =
  (transport: IpcInvokeTransport) =>
  async <Payload, Result>(
    descriptor: IpcInvokeDescriptor<Payload, Result>,
    payload: Payload,
  ): Promise<Result> => {
    const encodedPayload = descriptor.encodePayload(payload);
    const envelope = await transport(descriptor.channel, encodedPayload);
    if (!envelope.ok) {
      throw new DesktopBridgeError(envelope.error);
    }
    return descriptor.decodeResult(envelope.value);
  };

export const createObservedInvoke =
  (
    transport: IpcInvokeTransport,
    observer: IpcInvokeObserver,
    now: () => number = () => performance.now(),
  ) =>
  async <Payload, Result>(
    descriptor: IpcInvokeDescriptor<Payload, Result>,
    payload: Payload,
  ): Promise<Result> => {
    const startedAt = now();
    const startTimeUnixNano = unixTimeNanos();
    const trace = makeTraceContext();
    let stage: IpcInvokeObservationStage = "encode";

    try {
      const encodedPayload = descriptor.encodePayload(payload);
      stage = "transport";
      const envelope = await transport(descriptor.channel, {
        payload: encodedPayload,
        trace,
      } satisfies DesktopIpcTraceEnvelope);
      if (!envelope.ok) {
        stage = "main";
        throw new DesktopBridgeError(envelope.error);
      }
      stage = "decode";
      const result = descriptor.decodeResult(envelope.value);
      const endTimeUnixNano = unixTimeNanos();
      reportSafely(observer, {
        channel: descriptor.channel,
        durationMs: roundedDuration(now() - startedAt),
        endTimeUnixNano: endTimeUnixNano.toString(),
        name: descriptor.name,
        outcome: "success",
        startTimeUnixNano: startTimeUnixNano.toString(),
        trace,
      });
      return result;
    } catch (cause) {
      const endTimeUnixNano = unixTimeNanos();
      reportSafely(observer, {
        cause,
        channel: descriptor.channel,
        durationMs: roundedDuration(now() - startedAt),
        endTimeUnixNano: endTimeUnixNano.toString(),
        name: descriptor.name,
        outcome: "failure",
        startTimeUnixNano: startTimeUnixNano.toString(),
        stage,
        trace,
      });
      throw cause;
    }
  };

export const createSubscribe =
  (transport: IpcEventTransport) =>
  <Payload>(
    descriptor: IpcEventDescriptor<Payload>,
    listener: (payload: Payload) => void,
  ): (() => void) => {
    const subscription = (rawPayload: unknown): void => {
      try {
        listener(descriptor.decodePayload(rawPayload));
      } catch (cause) {
        console.error(`Failed to decode ${descriptor.name} event`, cause);
      }
    };

    transport.on(descriptor.channel, subscription);
    return () => {
      transport.removeListener(descriptor.channel, subscription);
    };
  };
