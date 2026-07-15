import { Cause, Effect } from "effect";

import type { ApiService } from "../../flash/api/Api";
import type { Packet, PacketSelector } from "../../flash/contract/Packet";
import type { ScriptAsyncScope } from "../scriptAsyncScope";
import {
  notifyScriptCallbackFailure,
  type ScriptCallbackResult,
} from "./Callbacks";

export interface ScriptPacketApi {
  readonly on: (
    selector: PacketSelector | undefined,
    handler: (packet: Packet) => ScriptCallbackResult,
  ) => Effect.Effect<() => void>;
  readonly once: ApiService["packet"]["once"];
  readonly sendClient: ApiService["packet"]["sendClient"];
  readonly sendServer: ApiService["packet"]["sendServer"];
  readonly stream: ApiService["packet"]["stream"];
}

export const makeScriptPacketApi = (
  packet: ApiService["packet"],
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ScriptPacketApi => ({
  ...packet,
  on: (selector, handler) =>
    packet
      .on(selector, notifyScriptCallbackFailure<Packet>(handler, failCause))
      .pipe(Effect.tap((dispose) => scope.addCleanup(dispose))),
});
