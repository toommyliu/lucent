import { Effect, Fiber, Stream } from "effect";

import type { GatewayService } from "../bridge/Gateway";
import { matchesPacket, type PacketSelector } from "../contract/Packet";
import type { Packet as PacketContract } from "../contract/Packet";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

const placeholders = [
  "MAP_ID",
  "ROOM_NUMBER",
  "MAP_NAME",
  "PLAYER_NAME",
] as const;

export const makePacket = Effect.fnUntraced(function* (
  gateway: GatewayService,
  store: Store,
  wait: Wait,
) {
  const scope = yield* Effect.scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const stream = (selector?: PacketSelector) =>
    gateway.packets.pipe(
      Stream.filter((packet) => matchesPacket(packet, selector)),
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

  const on = <E>(
    selector: PacketSelector | undefined,
    handler: (packet: PacketContract) => Effect.Effect<void, E>,
  ) =>
    stream(selector).pipe(
      Stream.runForEach(handler),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    );

  const once = wait.forPacket;

  const sendClient = (packet: string, type?: "str" | "json") =>
    resolve(packet).pipe(
      Effect.flatMap((resolved) => gateway.sendClient(resolved, type)),
    );

  const sendServer = (packet: string, type?: "String" | "Json") =>
    resolve(packet).pipe(
      Effect.flatMap((resolved) => gateway.sendServer(resolved, type)),
    );

  return {
    on,
    once,
    sendClient,
    sendServer,
    stream,
  };
});

export type Packet = Effect.Success<ReturnType<typeof makePacket>>;
