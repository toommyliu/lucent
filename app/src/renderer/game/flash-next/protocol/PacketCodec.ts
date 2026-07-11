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
    t: Schema.Literal("xt"),
    b: Schema.Struct({ o: UnknownRecord }),
  }),
);

const parseJson = (raw: string): Option.Option<unknown> => {
  try {
    return Option.some(JSON.parse(raw) as unknown);
  } catch {
    return Option.none();
  }
};

export const parseClientPacket = (raw: string) => {
  const trimmed = raw.trim();
  const payload = trimmed.startsWith("[Sending - STR]: ")
    ? trimmed.slice("[Sending - STR]: ".length)
    : trimmed;
  if (!payload.startsWith("%xt%")) return Option.none();

  const params = payload.split("%").filter(Boolean);
  const command = params[2];
  return command === undefined || command === ""
    ? Option.none()
    : decodeClientPacket({
        command,
        direction: "client",
        params,
        raw,
        wireType: "str",
      });
};

export const parseServerPacket = (raw: string) =>
  Option.flatMap(parseJson(raw), (value) => {
    const wrapped = decodeWrappedServer(value);
    if (Option.isSome(wrapped)) {
      const data = wrapped.value.b.o;
      return decodeServerPacket({
        command: typeof data["cmd"] === "string" ? data["cmd"] : "ct",
        data,
        direction: "server",
        raw,
        wireType: "json",
      });
    }

    return Option.flatMap(decodeRecord(value), (data) =>
      typeof data["cmd"] === "string"
        ? decodeServerPacket({
            command: data["cmd"],
            data,
            direction: "server",
            raw,
            wireType: "json",
          })
        : Option.none(),
    );
  });

export const parseExtensionPacket = (raw: string) =>
  Option.flatMap(parseJson(raw), (value) =>
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

      return Option.flatMap(decodeRecord(envelope.dataObj), (data) =>
        typeof data["cmd"] === "string"
          ? decodeExtensionPacket({
              command: data["cmd"],
              data,
              direction: "extension",
              raw,
              wireType: "json",
            })
          : Option.none(),
      );
    }),
  );

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
