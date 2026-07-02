import { Context, Effect, Layer, Option, PubSub } from "effect";

import type { FlashCallback } from "../FlashCallbacks";
import { FlashCallbacks } from "../FlashCallbacks";
import { SwfBridge } from "../SwfBridge";
import type {
  ClientPacketSendType,
  EventSelector,
  FlashEvent,
  FlashPacket,
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

export interface FlashProtocolShape {
  readonly emitEvent: (event: FlashEvent) => Effect.Effect<void>;
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

const callbackEvent = (callback: FlashCallback): FlashEvent | null => {
  switch (callback.type) {
    case "connection":
      return { payload: { status: callback.status }, type: "connection" };
    case "debug":
      return { payload: { message: callback.message }, type: "debug" };
    case "loaded":
      return { type: "loaded" };
    case "progress":
      return { payload: { percent: callback.percent }, type: "progress" };
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
    const runFork = Effect.runForkWith(yield* Effect.context<never>());

    const packetBus = makeHandlerBus<FlashPacket, PacketSelector>(
      matchesPacketSelector,
      runFork,
    );
    const eventBus = makeHandlerBus<FlashEvent, EventSelector>(
      matchesEventSelector,
      runFork,
    );

    const emitEvent: FlashProtocolShape["emitEvent"] = (event) =>
      eventBus.dispatch(event);

    const dispatchCallback = (callback: FlashCallback) =>
      Effect.gen(function* () {
        const event = callbackEvent(callback);
        if (event !== null) {
          yield* emitEvent(event);
        }

        const direction = directionFromCallback(callback);
        const raw = rawFromCallback(callback);
        if (direction === null || raw === null) {
          return;
        }

        const parsed = parseFlashPacket(direction, raw);
        if (Option.isNone(parsed)) {
          return;
        }

        yield* packetBus.dispatch(parsed.value);
      });

    const subscription = yield* callbacks.subscribe();
    yield* Effect.forkScoped(
      Effect.forever(
        PubSub.take(subscription).pipe(
          Effect.flatMap(dispatchCallback),
          Effect.catchCause((cause) =>
            Effect.logWarning({
              cause,
              message: "flash callback dispatch failed",
            }),
          ),
        ),
      ),
    );

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
      emitEvent,
      onEvent: eventBus.on,
      onPacket: packetBus.on,
      onceEvent: eventBus.once,
      oncePacket: packetBus.once,
      sendClient,
      sendServer,
    });
  }),
);
