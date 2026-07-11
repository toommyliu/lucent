import { Option, Schema } from "effect";

import {
  ClientPacket,
  ExtensionPacket,
  ServerPacket,
  type Packet,
  type PacketDirection,
} from "../contract/Packet";
import { UnknownRecord } from "../contract/Coercion";

const decodeClientPacket = Schema.decodeUnknownOption(ClientPacket);
const decodeServerPacket = Schema.decodeUnknownOption(ServerPacket);
const decodeExtensionPacket = Schema.decodeUnknownOption(ExtensionPacket);
const decodeRecord = Schema.decodeUnknownOption(UnknownRecord);
const decodeExtensionEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literals(["str", "json"]),
    dataObj: Schema.Unknown,
  }),
);
const decodeWrappedServer = Schema.decodeUnknownOption(
  Schema.Struct({
    t: Schema.String,
    b: Schema.Struct({ o: Schema.Unknown }),
  }),
);

const logPrefixes = [
  "[Sending - JSON]: ",
  "[Sending - STR]: ",
  "[ RECEIVED ]: ",
  "[Sending]: ",
] as const;

const stripLogEnvelope = (raw: string): string => {
  const trimmed = raw.trim();
  const prefix = logPrefixes.find((candidate) => trimmed.startsWith(candidate));
  const payload = prefix === undefined ? trimmed : trimmed.slice(prefix.length);
  return payload.replace(/, \(len: \d+\)$/u, "").trim();
};

const stringPacket = (
  payload: string,
):
  | { readonly command: string; readonly params: readonly string[] }
  | undefined => {
  if (!payload.startsWith("%xt%")) return undefined;
  const params = payload.split("%").filter(Boolean);
  const command = params[params[1] === "zm" ? 2 : 1];
  return command === undefined || command === ""
    ? undefined
    : { command, params };
};

const parseJson = (raw: string): Option.Option<unknown> => {
  try {
    return Option.some(JSON.parse(raw) as unknown);
  } catch {
    return Option.none();
  }
};

export const isUnsupportedPacketEnvelope = (raw: string): boolean => {
  const payload = stripLogEnvelope(raw);
  if (payload.startsWith("<")) return true;

  const parsed = parseJson(payload);
  if (Option.isNone(parsed)) return false;
  const record = decodeRecord(parsed.value);
  return Option.isSome(record) && record.value["type"] === "xml";
};

export const parseClientPacket = (raw: string) => {
  const payload = stripLogEnvelope(raw);
  const packet = stringPacket(payload);
  return packet === undefined
    ? Option.none()
    : decodeClientPacket({
        command: packet.command,
        direction: "client",
        params: packet.params,
        raw,
        wireType: "str",
      });
};

export const parseServerPacket = (raw: string) => {
  const payload = stripLogEnvelope(raw);
  const packet = stringPacket(payload);
  if (packet !== undefined) {
    return decodeServerPacket({
      command: packet.command,
      data: packet.params,
      direction: "server",
      raw,
      wireType: "str",
    });
  }

  return Option.flatMap(parseJson(payload), (value) => {
    const wrapped = decodeWrappedServer(value);
    if (Option.isSome(wrapped)) {
      const decodedData = decodeRecord(wrapped.value.b.o);
      if (Option.isNone(decodedData)) return Option.none();
      const data = decodedData.value;
      const command = data["cmd"];
      return typeof command !== "string" || command === ""
        ? Option.none()
        : decodeServerPacket({
            command,
            data,
            direction: "server",
            raw,
            wireType: "json",
          });
    }

    return Option.flatMap(decodeRecord(value), (data) => {
      const command = data["cmd"];
      return typeof command === "string" && command !== ""
        ? decodeServerPacket({
            command,
            data,
            direction: "server",
            raw,
            wireType: "json",
          })
        : Option.none();
    });
  });
};

export const parseExtensionPacket = (raw: string) => {
  const payload = stripLogEnvelope(raw);
  return Option.flatMap(parseJson(payload), (value) =>
    Option.flatMap(decodeExtensionEnvelope(value), (envelope) => {
      if (envelope.type === "str") {
        if (!Array.isArray(envelope.dataObj)) return Option.none();
        const command = envelope.dataObj[0];
        return typeof command === "string"
          ? decodeExtensionPacket({
              command,
              data: envelope.dataObj,
              direction: "extension",
              raw,
              wireType: "str",
            })
          : Option.none();
      }

      const data = decodeRecord(envelope.dataObj);
      if (Option.isSome(data)) {
        const command = data.value["cmd"];
        return typeof command === "string" && command !== ""
          ? decodeExtensionPacket({
              command,
              data: data.value,
              direction: "extension",
              raw,
              wireType: "json",
            })
          : Option.none();
      }
      return Option.none();
    }),
  );
};

export const parsePacket = (
  direction: PacketDirection,
  raw: string,
): Option.Option<Packet> => {
  switch (direction) {
    case "client":
      return parseClientPacket(raw);
    case "server":
      return parseServerPacket(raw);
    case "extension":
      return parseExtensionPacket(raw);
  }
};
