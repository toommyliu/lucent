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

  return {
    on,
    once: packet.once,
    sendClient: packet.sendClient,
    sendServer: packet.sendServer,
    stream: packet.stream,
  };
};
