import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import type { GatewayService } from "../bridge/Gateway";
import {
  matchesPacket,
  type Packet as PacketContract,
  type PacketDirection,
  type PacketForDirection,
  type PacketForSelector,
  type PacketSelector,
  type RawPacket,
} from "../contract/Packet";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

interface OnPacket {
  <const D extends PacketDirection, E>(
    selector: PacketSelector & { readonly direction: D },
    handler: (packet: PacketForDirection<D>) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void>;
  <E>(
    selector: PacketSelector | undefined,
    handler: (packet: PacketContract) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void>;
}

const placeholders = [
  "MAP_ID",
  "ROOM_NUMBER",
  "MAP_NAME",
  "PLAYER_NAME",
] as const;

export type ClientPacketSendType = "str" | "json" | "xml";

export const makePacket = Effect.fnUntraced(function* (
  gateway: GatewayService,
  store: Store,
  wait: Wait,
) {
  const scope = yield* Effect.scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const stream = <
    const S extends PacketSelector | undefined = PacketSelector | undefined,
  >(
    selector?: S,
  ) =>
    gateway.packets.pipe(
      Stream.filter((packet): packet is PacketForSelector<S> =>
        matchesPacket(packet, selector),
      ),
    );
  const resolve = (packet: string) =>
    Effect.gen(function* () {
      if (!placeholders.some((token) => packet.includes(`{${token}}`))) {
        return packet;
      }
      const map = yield* store.world.getMap;
      const player = yield* store.world.getMe;
      return packet
        .replaceAll("{MAP_ID}", String(map.id))
        .replaceAll("{ROOM_NUMBER}", String(map.roomNumber))
        .replaceAll("{MAP_NAME}", map.name)
        .replaceAll("{PLAYER_NAME}", player?.username ?? "");
    });

  const on = ((
    selector: PacketSelector | undefined,
    handler: (packet: PacketContract) => Effect.Effect<void, unknown>,
  ) =>
    stream(selector).pipe(
      Stream.runForEach(handler),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    )) as OnPacket;
  const onRaw = <E>(
    handler: (packet: RawPacket) => Effect.Effect<void, E>,
  ): Effect.Effect<() => void> =>
    gateway.rawPackets.pipe(
      Stream.runForEach(handler),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    );

  const once = wait.forPacket;

  const sendClient = (packet: string, type?: ClientPacketSendType) =>
    resolve(packet).pipe(
      Effect.flatMap((resolved) => gateway.sendClient(resolved, type)),
    );

  const sendServer = (packet: string, type?: "String" | "Json") =>
    resolve(packet).pipe(
      Effect.flatMap((resolved) => gateway.sendServer(resolved, type)),
    );

  return {
    on,
    onRaw,
    once,
    sendClient,
    sendServer,
    stream,
  };
});

export type Packet = Effect.Success<ReturnType<typeof makePacket>>;
