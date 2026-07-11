import { Cause, Context, Effect, Layer, Option } from "effect";

import type { FlashCallback } from "../FlashCallbacks";
import { FlashCallbacks } from "../FlashCallbacks";
import { SwfBridge } from "../SwfBridge";
import type {
  ClientPacketSendType,
  EventSelector,
  FlashEvent,
  FlashPacket,
  FlashProjectionEvent,
  FlashRuntimeEvent,
  PacketSelector,
  ServerPacketSendType,
  WaitOptions,
} from "../Types";
import { WorldState } from "../state/World";
import { makeHandlerBus } from "./EventBus";
import { parseFlashPacket } from "./PacketParser";
import { matchesEventSelector, matchesPacketSelector } from "./PacketSelectors";

export type FlashPacketHandler = (packet: FlashPacket) => Effect.Effect<void>;

export type FlashEventHandler = (event: FlashEvent) => Effect.Effect<void>;

export type FlashPacketProjector = (
  packet: FlashPacket,
) => Effect.Effect<readonly FlashProjectionEvent[]>;

export type FlashRuntimeProjector = (
  event: FlashRuntimeEvent,
) => Effect.Effect<void>;

export interface FlashProtocolShape {
  readonly installPacketProjector: (
    projector: FlashPacketProjector,
  ) => Effect.Effect<() => void>;
  readonly installRuntimeProjector: (
    projector: FlashRuntimeProjector,
  ) => Effect.Effect<() => void>;
  readonly onEvent: (
    selector: EventSelector | undefined,
    handler: FlashEventHandler,
  ) => Effect.Effect<() => void>;
  readonly onPacket: (
    selector: PacketSelector | undefined,
    handler: FlashPacketHandler,
  ) => Effect.Effect<() => void>;
  readonly onceEvent: (
    selector?: EventSelector,
    options?: Pick<WaitOptions, "timeout">,
  ) => Effect.Effect<FlashEvent | null>;
  readonly oncePacket: (
    selector?: PacketSelector,
    options?: Pick<WaitOptions, "timeout">,
  ) => Effect.Effect<FlashPacket | null>;
  readonly sendClient: (
    packet: string,
    type?: ClientPacketSendType,
  ) => Effect.Effect<void>;
  readonly sendServer: (
    packet: string,
    type?: ServerPacketSendType,
  ) => Effect.Effect<void>;
  readonly start: () => Effect.Effect<void>;
}

export class FlashProtocol extends Context.Service<
  FlashProtocol,
  FlashProtocolShape
>()("lucent/game/flash/protocol/FlashProtocol") {}

const placeholderTokens = [
  "{MAP_ID}",
  "{ROOM_NUMBER}",
  "{MAP_NAME}",
  "{PLAYER_NAME}",
] as const;

const hasPlaceholders = (packet: string): boolean =>
  placeholderTokens.some((token) => packet.includes(token));

const directionFromCallback = (
  callback: FlashCallback,
): "client" | "server" | "extension" | null => {
  switch (callback.type) {
    case "client-packet":
      return "client";
    case "server-packet":
      return "server";
    case "extension-packet":
      return "extension";
    default:
      return null;
  }
};

const rawFromCallback = (callback: FlashCallback): string | null => {
  switch (callback.type) {
    case "client-packet":
    case "extension-packet":
    case "server-packet":
      return callback.raw;
    default:
      return null;
  }
};

const callbackEvent = (callback: FlashCallback): FlashRuntimeEvent | null => {
  switch (callback.type) {
    case "connection":
      return {
        kind: "runtime",
        payload: { status: callback.status },
        type: "connection",
      };
    case "debug":
      return {
        kind: "runtime",
        payload: { message: callback.message },
        type: "debug",
      };
    case "loaded":
      return { kind: "runtime", type: "loaded" };
    case "progress":
      return {
        kind: "runtime",
        payload: { percent: callback.percent },
        type: "progress",
      };
    default:
      return null;
  }
};

export const layer = Layer.effect(
  FlashProtocol,
  Effect.gen(function* () {
    const callbacks = yield* FlashCallbacks;
    const bridge = yield* SwfBridge;
    const maybeWorld = yield* Effect.serviceOption(WorldState);
    const scope = yield* Effect.scope;
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    let packetProjector: FlashPacketProjector | undefined;
    let runtimeProjector: FlashRuntimeProjector | undefined;
    let started = false;

    const packetBus = makeHandlerBus<FlashPacket, PacketSelector>(
      matchesPacketSelector,
      runFork,
    );
    const eventBus = makeHandlerBus<FlashEvent, EventSelector>(
      matchesEventSelector,
      runFork,
    );

    const dispatchEvent = (event: FlashEvent) => eventBus.dispatch(event);

    const installPacketProjector: FlashProtocolShape["installPacketProjector"] =
      (projector) =>
        Effect.sync(() => {
          if (started || packetProjector !== undefined) {
            throw new Error("Flash packet projector is already installed");
          }

          packetProjector = projector;
          return () => {
            if (!started && packetProjector === projector) {
              packetProjector = undefined;
            }
          };
        });

    const installRuntimeProjector: FlashProtocolShape["installRuntimeProjector"] =
      (projector) =>
        Effect.sync(() => {
          if (started || runtimeProjector !== undefined) {
            throw new Error("Flash runtime projector is already installed");
          }

          runtimeProjector = projector;
          return () => {
            if (!started && runtimeProjector === projector) {
              runtimeProjector = undefined;
            }
          };
        });

    const runPacketProjector = (packet: FlashPacket) =>
      packetProjector === undefined
        ? Effect.succeed<readonly FlashProjectionEvent[]>([])
        : packetProjector(packet).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) =>
                Effect.logWarning({
                  cause,
                  command: packet.command,
                  message: "flash packet projection failed",
                }).pipe(Effect.as<readonly FlashProjectionEvent[]>([])),
            ),
          );

    const runRuntimeProjector = (event: FlashRuntimeEvent) =>
      runtimeProjector === undefined
        ? Effect.void
        : runtimeProjector(event).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) =>
                Effect.logWarning({
                  cause,
                  message: "flash runtime projection failed",
                  type: event.type,
                }),
            ),
          );

    const dispatchCallback = (callback: FlashCallback) =>
      Effect.gen(function* () {
        const event = callbackEvent(callback);
        if (event !== null) {
          yield* runRuntimeProjector(event);
          yield* dispatchEvent(event);
        }

        const direction = directionFromCallback(callback);
        const raw = rawFromCallback(callback);
        if (direction === null || raw === null) {
          return;
        }

        const parsed = parseFlashPacket(direction, raw);
        if (Option.isNone(parsed)) {
          yield* dispatchEvent({
            kind: "packet",
            payload: { direction, raw },
            type: "packetParseFailed",
          });
          return;
        }

        const projectionEvents = yield* runPacketProjector(parsed.value);
        yield* dispatchEvent({
          kind: "packet",
          payload: parsed.value,
          type: "packetReceived",
        });
        yield* packetBus.dispatch(parsed.value);
        for (const projectionEvent of projectionEvents) {
          yield* dispatchEvent(projectionEvent);
        }
      });

    const drainCallbacks = Effect.forever(
      callbacks.take().pipe(
        Effect.flatMap((callback) =>
          dispatchCallback(callback).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) =>
                Effect.logWarning({
                  cause,
                  message: "flash callback dispatch failed",
                }),
            ),
          ),
        ),
      ),
    );

    const start: FlashProtocolShape["start"] = () =>
      Effect.suspend(() => {
        if (started) {
          return Effect.void;
        }
        if (packetProjector === undefined || runtimeProjector === undefined) {
          return Effect.die(
            new Error("Flash projectors must be installed before starting"),
          );
        }

        started = true;
        return Effect.forkIn(drainCallbacks, scope).pipe(Effect.asVoid);
      });

    const resolvePlaceholders = (packet: string) =>
      Effect.gen(function* () {
        if (!hasPlaceholders(packet)) {
          return packet;
        }

        const map = Option.isSome(maybeWorld)
          ? yield* maybeWorld.value.getMap()
          : { id: 0, name: "", roomNumber: 0 };
        const player = Option.isSome(maybeWorld)
          ? yield* maybeWorld.value.getMe()
          : null;
        const playerName = player?.username ?? player?.name ?? "";

        return packet
          .split("{MAP_ID}")
          .join(String(map.id))
          .split("{ROOM_NUMBER}")
          .join(String(map.roomNumber))
          .split("{MAP_NAME}")
          .join(map.name)
          .split("{PLAYER_NAME}")
          .join(playerName);
      });

    const sendClient: FlashProtocolShape["sendClient"] = (
      packet,
      type = "str",
    ) =>
      resolvePlaceholders(packet).pipe(
        Effect.flatMap((resolved) =>
          bridge.call("flash.sendClientPacket", [resolved, type]),
        ),
      );

    const sendServer: FlashProtocolShape["sendServer"] = (
      packet,
      type = "String",
    ) =>
      resolvePlaceholders(packet).pipe(
        Effect.flatMap((resolved) =>
          bridge.callGameFunction(`sfc.send${type}`, resolved),
        ),
        Effect.asVoid,
      );

    return FlashProtocol.of({
      installPacketProjector,
      installRuntimeProjector,
      onEvent: eventBus.on,
      onPacket: packetBus.on,
      onceEvent: eventBus.once,
      oncePacket: packetBus.once,
      sendClient,
      sendServer,
      start,
    });
  }),
);
