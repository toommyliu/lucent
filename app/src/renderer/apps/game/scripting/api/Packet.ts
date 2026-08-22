import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { ApiService } from "../../flash/api/Api";
import type { FlashPacket, PacketSelector } from "../../flash/contract/Packet";
import type { ScriptPacketApi, ScriptPacketOn } from "../ScriptApi";
import type { ScriptAsyncScope } from "../scriptAsyncScope";
import {
  notifyScriptCallbackFailure,
  type ScriptCallbackResult,
} from "./Callbacks";

const clientPacketTypes = {
  json: "json",
  string: "str",
  xml: "xml",
} as const;

const serverPacketTypes = {
  json: "Json",
  string: "String",
} as const;

export const makeScriptPacketApi = (
  packet: ApiService["packet"],
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ScriptPacketApi => {
  const on = ((
    selector: PacketSelector | undefined,
    handler: (packet: FlashPacket) => ScriptCallbackResult,
  ) =>
    packet
      .on(selector, notifyScriptCallbackFailure(handler, failCause))
      .pipe(
        Effect.tap((dispose) => scope.addCleanup(dispose)),
      )) as ScriptPacketOn;

  const sendClient: ScriptPacketApi["sendClient"] = (
    rawPacket,
    encoding = "string",
  ) => packet.sendClient(rawPacket, clientPacketTypes[encoding]);
  const sendServer: ScriptPacketApi["sendServer"] = (
    rawPacket,
    encoding = "string",
  ) => packet.sendServer(rawPacket, serverPacketTypes[encoding]);

  return {
    ...packet,
    on,
    sendClient,
    sendServer,
  };
};
