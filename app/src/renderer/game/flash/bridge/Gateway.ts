import {
  Context,
  Effect,
  Layer,
  Option,
  PubSub,
  Queue,
  Schema,
  Stream,
} from "effect";

import { decodeCallback, type Callback } from "../contract/Callback";
import type { Diagnostic } from "../contract/Diagnostic";
import { makeDiagnostic } from "../contract/Diagnostic";
import type { Event, RuntimeEvent } from "../contract/Event";
import type { Packet, PacketDirection } from "../contract/Packet";
import {
  isUnsupportedPacketEnvelope,
  parsePacket,
} from "../protocol/PacketCodec";
import type { ProjectionTrace } from "../protocol/Pipeline";
import { Bridge } from "./Bridge";

type CallbackKey =
  | "onConnection"
  | "onDebug"
  | "onExtensionResponse"
  | "packetFromClient"
  | "packetFromServer";

type OwnedCallbacks = Required<Pick<Window, CallbackKey>>;

const packetInput = (
  callback: Callback,
):
  | { readonly direction: PacketDirection; readonly raw: string }
  | undefined => {
  switch (callback.type) {
    case "client-packet":
      return { direction: "client", raw: callback.raw };
    case "extension-packet":
      return { direction: "extension", raw: callback.raw };
    case "server-packet":
      return { direction: "server", raw: callback.raw };
    default:
      return undefined;
  }
};

const runtimeEvent = (callback: Callback): RuntimeEvent | undefined => {
  switch (callback.type) {
    case "connection":
      return { type: "connection", status: callback.status };
    case "debug":
      return { type: "debug", message: callback.message };
    default:
      return undefined;
  }
};

export const makeGateway = (target?: Window) =>
  Effect.gen(function* () {
    const resolvedTarget = target ?? window;
    const bridge = yield* Bridge;
    const scope = yield* Effect.scope;
    const callbacks = yield* Queue.unbounded<Callback>();
    const diagnostics = yield* PubSub.unbounded<Diagnostic>({ replay: 64 });
    const events = yield* PubSub.unbounded<Event>();
    const packets = yield* PubSub.unbounded<Packet>();
    let started = false;

    yield* Effect.addFinalizer(() =>
      Effect.all(
        [
          Queue.shutdown(callbacks),
          PubSub.shutdown(diagnostics),
          PubSub.shutdown(events),
          PubSub.shutdown(packets),
        ],
        { discard: true },
      ),
    );

    yield* bridge.diagnostics.pipe(
      Stream.runForEach((diagnostic) =>
        PubSub.publish(diagnostics, diagnostic),
      ),
      Effect.forkIn(scope),
    );

    const publishDiagnosticUnsafe = (
      phase: Diagnostic["phase"],
      operation: string,
      cause: unknown,
      args?: readonly unknown[],
    ): void => {
      PubSub.publishUnsafe(
        diagnostics,
        makeDiagnostic(phase, operation, cause, args),
      );
    };

    const offer = (operation: string, value: unknown): void => {
      const decoded = decodeCallback(value);
      if (Option.isNone(decoded)) {
        publishDiagnosticUnsafe(
          "callback-decode",
          operation,
          new Error("Invalid callback input"),
          [value],
        );
        return;
      }
      if (!Queue.offerUnsafe(callbacks, decoded.value)) {
        publishDiagnosticUnsafe(
          "callback-dispatch",
          operation,
          new Error("Callback queue is unavailable"),
        );
      }
    };

    const owned: OwnedCallbacks = {
      onConnection: (status) =>
        offer("onConnection", { type: "connection", status }),
      onDebug: (message) => offer("onDebug", { type: "debug", message }),
      onExtensionResponse: (raw) =>
        offer("onExtensionResponse", { type: "extension-packet", raw }),
      packetFromClient: (raw) =>
        offer("packetFromClient", { type: "client-packet", raw }),
      packetFromServer: (raw) =>
        offer("packetFromServer", { type: "server-packet", raw }),
    };

    for (const key of Object.keys(owned) as CallbackKey[]) {
      resolvedTarget[key] = owned[key] as never;
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const key of Object.keys(owned) as CallbackKey[]) {
          if (resolvedTarget[key] === owned[key]) delete resolvedTarget[key];
        }
      }),
    );

    const publishEvent = (event: Event) =>
      PubSub.publish(events, event).pipe(Effect.asVoid);

    const reportDiagnostic = (
      operation: string,
      cause: unknown,
      args?: readonly unknown[],
    ) =>
      PubSub.publish(
        diagnostics,
        makeDiagnostic("projection", operation, cause, args),
      ).pipe(Effect.asVoid);

    const reportProjectionTrace = (operation: string, trace: ProjectionTrace) =>
      PubSub.publish(
        diagnostics,
        makeDiagnostic("projection-trace", operation, undefined, [trace]),
      ).pipe(Effect.asVoid);

    const dispatch = (
      callback: Callback,
      project: (packet: Packet) => Effect.Effect<void>,
      projectRuntime: (event: RuntimeEvent) => Effect.Effect<void>,
    ) =>
      Effect.gen(function* () {
        const event = runtimeEvent(callback);
        if (event !== undefined) {
          yield* projectRuntime(event);
          yield* publishEvent(event);
          return;
        }

        const input = packetInput(callback);
        if (input === undefined) return;

        const packet = parsePacket(input.direction, input.raw);
        if (Option.isNone(packet)) {
          if (isUnsupportedPacketEnvelope(input.raw)) return;
          const failure: Event = {
            type: "packet-decode-failed",
            direction: input.direction,
            raw: input.raw,
          };
          yield* PubSub.publish(
            diagnostics,
            makeDiagnostic(
              "packet-decode",
              `${input.direction}:packet`,
              new Error("Malformed packet envelope"),
              [input.raw],
            ),
          );
          yield* publishEvent(failure);
          return;
        }

        yield* project(packet.value);
        yield* PubSub.publish(packets, packet.value);
        yield* publishEvent({ type: "packet", packet: packet.value });
      });

    const start = (
      project: (packet: Packet) => Effect.Effect<void>,
      projectRuntime: (event: RuntimeEvent) => Effect.Effect<void> = () =>
        Effect.void,
    ) =>
      Effect.suspend(() => {
        if (started) return Effect.void;
        started = true;
        const drain = Effect.forever(
          Queue.take(callbacks).pipe(
            Effect.flatMap((callback) =>
              dispatch(callback, project, projectRuntime),
            ),
            Effect.catchCause((cause) =>
              PubSub.publish(
                diagnostics,
                makeDiagnostic("callback-dispatch", "drain", cause),
              ).pipe(Effect.asVoid),
            ),
          ),
        );
        return Effect.forkIn(drain, scope).pipe(Effect.asVoid);
      });

    const sendClient = (packet: string, type = "str") =>
      bridge
        .invoke("flash.sendClientPacket", [packet, type], Schema.Void)
        .pipe(Effect.map(Option.isSome));

    const sendServer = (packet: string, type = "String") =>
      bridge
        .invoke(
          "flash.callGameFunction",
          [`sfc.send${type}`, packet],
          Schema.String,
        )
        .pipe(Effect.map(Option.isSome));

    return {
      diagnostics: Stream.fromPubSub(diagnostics),
      events: Stream.fromPubSub(events),
      packets: Stream.fromPubSub(packets),
      publishEvent,
      reportDiagnostic,
      reportProjectionTrace,
      sendClient,
      sendServer,
      start,
      subscribeEvents: PubSub.subscribe(events),
      subscribePackets: PubSub.subscribe(packets),
    };
  });

export class Gateway extends Context.Service<Gateway>()(
  "lucent/renderer/flash/Gateway",
  { make: makeGateway() },
) {}

export type GatewayService = Effect.Success<ReturnType<typeof makeGateway>>;

export const layer = Layer.effect(Gateway, Gateway.make);
