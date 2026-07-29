import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { ApiService } from "../../flash/api/Api";
import type {
  FlashPacket,
  PacketDirection,
  PacketForDirection,
  PacketSelector,
} from "../../flash/contract/Packet";
import type { ScriptAsyncScope } from "../scriptAsyncScope";
import {
  notifyScriptCallbackFailure,
  type ScriptCallbackResult,
} from "./Callbacks";

interface ScriptPacketOn {
  <const D extends PacketDirection>(
    selector: PacketSelector & { readonly direction: D },
    handler: (packet: PacketForDirection<D>) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
  (
    selector: PacketSelector | undefined,
    handler: (packet: FlashPacket) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
}

export interface ScriptPacketApi {
  readonly on: ScriptPacketOn;
  readonly once: ApiService["packet"]["once"];
  readonly sendClient: ApiService["packet"]["sendClient"];
  readonly sendServer: ApiService["packet"]["sendServer"];
  readonly stream: ApiService["packet"]["stream"];
}

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
    ...packet,
    on,
  };
};
