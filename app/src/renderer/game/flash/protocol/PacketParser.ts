import { Option, Schema } from "effect";

import {
  ClientPacketSchema,
  ExtensionPacketSchema,
  ServerPacketSchema,
  type ClientPacket,
  type ExtensionPacket,
  type FlashPacket,
  type ServerPacket,
} from "../Types";
import { asRecord } from "../payload";

const clientPacketPrefix = "[Sending - STR]: ";
const xtPrefix = "%xt%";

const decodeClientPacket = Schema.decodeUnknownOption(ClientPacketSchema);
const decodeServerPacket = Schema.decodeUnknownOption(ServerPacketSchema);
const decodeExtensionPacket = Schema.decodeUnknownOption(ExtensionPacketSchema);

const parseJson = (raw: string): Option.Option<unknown> => {
  try {
    return Option.some(JSON.parse(raw) as unknown);
  } catch {
    return Option.none();
  }
};

const stripClientPrefix = (raw: string): string =>
  raw.startsWith(clientPacketPrefix)
    ? raw.slice(clientPacketPrefix.length)
    : raw;

export const parseClientPacket = (raw: string): Option.Option<ClientPacket> => {
  const payload = stripClientPrefix(raw.trim());
  if (!payload.startsWith(xtPrefix)) {
    return Option.none();
  }

  const params = payload.split("%").filter(Boolean);
  const command = params[2];
  if (command === undefined || command === "") {
    return Option.none();
  }

  return decodeClientPacket({
    command,
    direction: "client",
    params,
    raw,
    wireType: "str",
  });
};

export const parseServerPacket = (raw: string): Option.Option<ServerPacket> => {
  const parsed = parseJson(raw);
  if (Option.isNone(parsed)) {
    return Option.none();
  }

  const top = asRecord(parsed.value);
  const body = asRecord(top?.["b"]);
  const data = asRecord(body?.["o"]);
  if (top?.["t"] === "xt" && data !== null) {
    const command = typeof data["cmd"] === "string" ? data["cmd"] : "ct";
    return decodeServerPacket({
      command,
      data,
      direction: "server",
      raw,
      wireType: "json",
    });
  }

  const direct = asRecord(parsed.value);
  const command = typeof direct?.["cmd"] === "string" ? direct["cmd"] : null;
  if (direct !== null && command !== null) {
    return decodeServerPacket({
      command,
      data: direct,
      direction: "server",
      raw,
      wireType: "json",
    });
  }

  return Option.none();
};

export const parseExtensionPacket = (
  raw: string,
): Option.Option<ExtensionPacket> => {
  const parsed = parseJson(raw);
  if (Option.isNone(parsed)) {
    return Option.none();
  }

  const payload = asRecord(parsed.value);
  if (payload === null) {
    return Option.none();
  }

  if (payload["type"] === "str") {
    const data = Array.isArray(payload["dataObj"]) ? payload["dataObj"] : null;
    const command = typeof data?.[0] === "string" ? data[0] : null;
    if (data === null || command === null) {
      return Option.none();
    }

    return decodeExtensionPacket({
      command,
      data,
      direction: "extension",
      raw,
      wireType: "str",
    });
  }

  if (payload["type"] === "json") {
    const data = asRecord(payload["dataObj"]);
    const command = typeof data?.["cmd"] === "string" ? data["cmd"] : null;
    if (data === null || command === null) {
      return Option.none();
    }

    return decodeExtensionPacket({
      command,
      data,
      direction: "extension",
      raw,
      wireType: "json",
    });
  }

  return Option.none();
};

export const parseFlashPacket = (
  direction: "client" | "server" | "extension",
  raw: string,
): Option.Option<FlashPacket> => {
  switch (direction) {
    case "client":
      return parseClientPacket(raw);
    case "server":
      return parseServerPacket(raw);
    case "extension":
      return parseExtensionPacket(raw);
  }
};
