import { Schema } from "effect";
import type { Duration } from "effect";

export const PacketDirection = Schema.Literals([
  "client",
  "server",
  "extension",
]);
export type PacketDirection = typeof PacketDirection.Type;

export const PacketWireType = Schema.Literals(["str", "json"]);
export type PacketWireType = typeof PacketWireType.Type;

export const ClientPacket = Schema.Struct({
  command: Schema.String,
  direction: Schema.Literal("client"),
  params: Schema.Array(Schema.String),
  raw: Schema.String,
  wireType: PacketWireType,
});
export type ClientPacket = typeof ClientPacket.Type;

export const ServerPacket = Schema.Struct({
  command: Schema.String,
  data: Schema.Unknown,
  direction: Schema.Literal("server"),
  raw: Schema.String,
  wireType: PacketWireType,
});
export type ServerPacket = typeof ServerPacket.Type;

export const ExtensionPacket = Schema.Struct({
  command: Schema.String,
  data: Schema.Unknown,
  direction: Schema.Literal("extension"),
  raw: Schema.String,
  wireType: PacketWireType,
});
export type ExtensionPacket = typeof ExtensionPacket.Type;

export const Packet = Schema.Union([
  ClientPacket,
  ServerPacket,
  ExtensionPacket,
]);
export type FlashPacket = ClientPacket | ServerPacket | ExtensionPacket;
export type Packet = FlashPacket;

export interface RawPacket {
  readonly direction: PacketDirection;
  readonly raw: string;
}

export interface PacketSelector {
  readonly command?: string;
  readonly direction?: PacketDirection;
  readonly predicate?: (packet: FlashPacket) => boolean;
  readonly wireType?: PacketWireType;
}

export interface WaitOptions {
  readonly interval?: Duration.Input;
  readonly timeout?: Duration.Input;
}

export type PacketForDirection<D extends PacketDirection> = Extract<
  FlashPacket,
  { readonly direction: D }
>;

export type PacketForSelector<S extends PacketSelector | undefined> =
  S extends {
    readonly direction: infer Direction extends PacketDirection;
  }
    ? PacketForDirection<Direction>
    : FlashPacket;

export const packetData = (packet: FlashPacket): unknown =>
  packet.direction === "client" ? packet.params : packet.data;

export const matchesPacket = <S extends PacketSelector | undefined>(
  packet: FlashPacket,
  selector: S,
): packet is PacketForSelector<S> =>
  (selector?.command === undefined || selector.command === packet.command) &&
  (selector?.direction === undefined ||
    selector.direction === packet.direction) &&
  (selector?.wireType === undefined || selector.wireType === packet.wireType) &&
  (selector?.predicate === undefined || selector.predicate(packet));
