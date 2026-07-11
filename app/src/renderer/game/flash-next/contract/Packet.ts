import { Schema } from "effect";
import type { Duration } from "effect";

export const PacketDirection = Schema.Literals([
  "client",
  "server",
  "extension",
]);
export type PacketDirection = typeof PacketDirection.Type;

export const PacketWireType = Schema.Literals([
  "str",
  "json",
  "xml",
  "unknown",
]);
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
export type Packet = typeof Packet.Type;

export interface PacketSelector {
  readonly command?: string;
  readonly direction?: PacketDirection;
  readonly wireType?: PacketWireType;
}

export interface WaitOptions {
  readonly interval?: Duration.Input;
  readonly timeout?: Duration.Input;
}

export const matchesPacket = (
  packet: Packet,
  selector: PacketSelector | undefined,
): boolean =>
  (selector?.command === undefined || selector.command === packet.command) &&
  (selector?.direction === undefined ||
    selector.direction === packet.direction) &&
  (selector?.wireType === undefined || selector.wireType === packet.wireType);
