import { Schema } from "effect";

export const PacketCaptureTypes = ["client", "server", "extension"] as const;
export const PacketCaptureTypeSchema = Schema.Literals(PacketCaptureTypes);
export type PacketCaptureType = typeof PacketCaptureTypeSchema.Type;

export const PacketSendTargets = [
  "server-string",
  "server-json",
  "client-str",
  "client-json",
  "client-xml",
] as const;
export const PacketSendTargetSchema = Schema.Literals(PacketSendTargets);
export type PacketSendTarget = typeof PacketSendTargetSchema.Type;

export const PacketCapturedPayloadSchema = Schema.Struct({
  capturedAt: Schema.Number,
  packet: Schema.String,
  type: PacketCaptureTypeSchema,
});
export type PacketCapturedPayload = typeof PacketCapturedPayloadSchema.Type;

export const PacketSendPayloadSchema = Schema.Struct({
  packet: Schema.String,
  target: PacketSendTargetSchema,
});
export type PacketSendPayload = typeof PacketSendPayloadSchema.Type;

export const PacketQueuePayloadSchema = Schema.Struct({
  delayMs: Schema.Number,
  packets: Schema.Array(Schema.String),
  target: PacketSendTargetSchema,
});
export type PacketQueuePayload = typeof PacketQueuePayloadSchema.Type;

export const PacketsStatusPayloadSchema = Schema.Struct({
  captureRunning: Schema.Boolean,
  queueRunning: Schema.Boolean,
  stoppedReason: Schema.optionalKey(Schema.String),
});
export type PacketsStatusPayload = typeof PacketsStatusPayloadSchema.Type;

export interface PacketPlaceholderContext {
  readonly mapId: number;
  readonly mapName: string;
  readonly playerName: string;
  readonly roomNumber: number;
}

export const PACKET_LOG_BUFFER_LIMIT = 5_000;
export const PACKET_QUEUE_DEFAULT_DELAY_MS = 1_000;
export const PACKET_QUEUE_MAX_DELAY_MS = 60_000;
export const PACKET_QUEUE_MIN_DELAY_MS = 10;

export const PACKET_PLACEHOLDER_DEFINITIONS = [
  {
    contextKey: "mapId",
    label: "Map ID",
    token: "{MAP_ID}",
  },
  {
    contextKey: "roomNumber",
    label: "Room Number",
    token: "{ROOM_NUMBER}",
  },
  {
    contextKey: "mapName",
    label: "Map Name",
    token: "{MAP_NAME}",
  },
  {
    contextKey: "playerName",
    label: "Player Name",
    token: "{PLAYER_NAME}",
  },
] as const satisfies readonly {
  readonly contextKey: keyof PacketPlaceholderContext;
  readonly label: string;
  readonly token: string;
}[];

export type PacketPlaceholderToken =
  (typeof PACKET_PLACEHOLDER_DEFINITIONS)[number]["token"];

const CLIENT_PACKET_PREFIX = "[Sending - STR]: ";

export const isPacketCaptureType = (
  value: unknown,
): value is PacketCaptureType =>
  typeof value === "string" &&
  PacketCaptureTypes.includes(value as PacketCaptureType);

export const isPacketSendTarget = (value: unknown): value is PacketSendTarget =>
  typeof value === "string" &&
  PacketSendTargets.includes(value as PacketSendTarget);

export const normalizePacketText = (
  packet: string,
  type: PacketCaptureType,
): string =>
  type === "client" && packet.startsWith(CLIENT_PACKET_PREFIX)
    ? packet.slice(CLIENT_PACKET_PREFIX.length)
    : packet;

export const normalizePacketQueuePayload = (
  payload: PacketQueuePayload,
): PacketQueuePayload => {
  const packets = payload.packets.filter((packet) => packet.trim() !== "");
  if (packets.length === 0) {
    throw new Error("Packet queue is empty");
  }

  return {
    delayMs: clampPacketQueueDelay(payload.delayMs),
    packets,
    target: payload.target,
  };
};

export const hasSupportedPacketPlaceholders = (packet: string): boolean =>
  PACKET_PLACEHOLDER_DEFINITIONS.some((definition) =>
    packet.includes(definition.token),
  );

export const resolvePacketPlaceholders = (
  packet: string,
  context: PacketPlaceholderContext,
): string => {
  let resolved = packet;
  for (const definition of PACKET_PLACEHOLDER_DEFINITIONS) {
    resolved = resolved
      .split(definition.token)
      .join(String(context[definition.contextKey]));
  }
  return resolved;
};

const parsePacketQueueDelay = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return Number.NaN;
  }

  const trimmed = value.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
};

export const clampPacketQueueDelay = (value: unknown): number => {
  const delayMs = parsePacketQueueDelay(value);
  return Number.isFinite(delayMs)
    ? Math.min(
        PACKET_QUEUE_MAX_DELAY_MS,
        Math.max(PACKET_QUEUE_MIN_DELAY_MS, Math.round(delayMs)),
      )
    : PACKET_QUEUE_DEFAULT_DELAY_MS;
};
