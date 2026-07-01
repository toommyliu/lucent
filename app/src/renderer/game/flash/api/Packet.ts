import { Context, Effect, Layer } from "effect";

import type {
  ClientPacketSendType,
  FlashPacket,
  PacketSelector,
  ServerPacketSendType,
  WaitOptions,
} from "../Types";
import { FlashProtocol } from "../protocol/FlashProtocol";

export type PacketHandler = (packet: FlashPacket) => Effect.Effect<void>;

export interface PacketApiShape {
  readonly on: (
    selector: PacketSelector | undefined,
    handler: PacketHandler,
  ) => Effect.Effect<() => void>;
  readonly once: (
    selector?: PacketSelector,
    options?: WaitOptions,
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

export class PacketApi extends Context.Service<PacketApi, PacketApiShape>()(
  "lucent/game/flash/api/Packet",
) {}

export const layer = Layer.effect(
  PacketApi,
  Effect.gen(function* () {
    const protocol = yield* FlashProtocol;

    return PacketApi.of({
      on: protocol.onPacket,
      once: (selector, options) =>
        protocol.oncePacket(
          selector,
          options?.timeout === undefined
            ? undefined
            : { timeout: options.timeout },
        ),
      sendClient: protocol.sendClient,
      sendServer: protocol.sendServer,
    });
  }),
);
