import { Effect, Schema } from "effect";

import {
  PacketsIpc,
  type IpcEventDescriptor,
  type IpcEventPayload,
} from "../../../shared/ipc";
import { normalizePacketQueuePayload } from "../../../shared/packets";
import {
  GamePackets,
  PacketsRequestError,
  type PacketsRequestInput,
} from "../../internal/packets/GamePackets";
import { DesktopWindows } from "../../window/DesktopWindows";
import { DesktopIpc, makeDesktopIpcMethod } from "../DesktopIpc";
import type { DesktopIpcSender } from "../DesktopIpcSenders";

export class PacketsOwnerError extends Schema.TaggedErrorClass<PacketsOwnerError>()(
  "PacketsOwnerError",
  {
    browserWindowId: Schema.Int,
  },
) {
  override get message(): string {
    return `The Packets window has no owning game: ${this.browserWindowId}`;
  }
}

const resolveOwningGame = Effect.fn("desktop.ipc.packets.resolveOwningGame")(
  function* (sender: DesktopIpcSender) {
    const windows = yield* DesktopWindows;
    const ownerBrowserWindowId = yield* windows.getOwnerBrowserWindowId(
      sender.browserWindowId,
    );
    if (
      ownerBrowserWindowId === null ||
      (yield* windows.getBrowserWindowKind(ownerBrowserWindowId)) !== "game"
    ) {
      return yield* new PacketsOwnerError({
        browserWindowId: sender.browserWindowId,
      });
    }
    return ownerBrowserWindowId;
  },
);

const requestGame = Effect.fn("desktop.ipc.packets.requestGame")(function* (
  sender: DesktopIpcSender,
  input: PacketsRequestInput,
) {
  const packets = yield* GamePackets;
  const gameBrowserWindowId = yield* resolveOwningGame(sender);
  yield* packets.request(gameBrowserWindowId, input);
});

const notifyPacketsWindow = Effect.fn("desktop.ipc.packets.notifyWindow")(
  function* <Descriptor extends IpcEventDescriptor<unknown>>(
    gameBrowserWindowId: number,
    descriptor: Descriptor,
    payload: IpcEventPayload<Descriptor>,
  ) {
    const ipc = yield* DesktopIpc;
    const windows = yield* DesktopWindows;
    const targets = yield* windows.getOwnedBrowserWindowIds(
      gameBrowserWindowId,
      "packets",
    );
    yield* ipc.sendToBrowserWindowIds(targets, descriptor, payload);
  },
);

export const startCapture = makeDesktopIpcMethod({
  descriptor: PacketsIpc.startCapture,
  allowedSenders: ["packets"],
  handler: (_payload, sender) => requestGame(sender, { kind: "start-capture" }),
});

export const stopCapture = makeDesktopIpcMethod({
  descriptor: PacketsIpc.stopCapture,
  allowedSenders: ["packets"],
  handler: (_payload, sender) => requestGame(sender, { kind: "stop-capture" }),
});

export const send = makeDesktopIpcMethod({
  descriptor: PacketsIpc.send,
  allowedSenders: ["packets"],
  handler: (payload, sender) => requestGame(sender, { kind: "send", payload }),
});

export const startQueue = makeDesktopIpcMethod({
  descriptor: PacketsIpc.startQueue,
  allowedSenders: ["packets"],
  handler: (payload, sender) =>
    Effect.try({
      try: () => normalizePacketQueuePayload(payload),
      catch: (cause) =>
        new PacketsRequestError({
          detail:
            cause instanceof Error && cause.message !== ""
              ? cause.message
              : "Invalid packet queue.",
        }),
    }).pipe(
      Effect.flatMap((normalized) =>
        requestGame(sender, { kind: "start-queue", payload: normalized }),
      ),
    ),
});

export const stopQueue = makeDesktopIpcMethod({
  descriptor: PacketsIpc.stopQueue,
  allowedSenders: ["packets"],
  handler: (_payload, sender) => requestGame(sender, { kind: "stop-queue" }),
});

export const publishCaptured = makeDesktopIpcMethod({
  descriptor: PacketsIpc.publishCaptured,
  allowedSenders: ["game"],
  handler: (payload, sender) =>
    notifyPacketsWindow(sender.browserWindowId, PacketsIpc.captured, payload),
});

export const publishStatus = makeDesktopIpcMethod({
  descriptor: PacketsIpc.publishStatus,
  allowedSenders: ["game"],
  handler: (payload, sender) =>
    notifyPacketsWindow(sender.browserWindowId, PacketsIpc.status, payload),
});

export const respond = makeDesktopIpcMethod({
  descriptor: PacketsIpc.respond,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.packets.respond")(
    function* (response, sender) {
      const packets = yield* GamePackets;
      yield* packets.respond(sender.browserWindowId, response);
    },
  ),
});

export const methods = [
  startCapture,
  stopCapture,
  send,
  startQueue,
  stopQueue,
  publishCaptured,
  publishStatus,
  respond,
] as const;
