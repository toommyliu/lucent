import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";

import type { LoaderGrabberError } from "../../../shared/gameRendererRpc";
import { LoaderGrabberIpc } from "../../../shared/ipc";
import {
  GameRendererRpc,
  type GameRendererRpcClient,
} from "../../internal/game-renderer/GameRendererRpc";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeDesktopIpcMethod } from "../DesktopIpc";
import type { DesktopIpcSender } from "../DesktopIpcSenders";

const LOADER_GRABBER_REQUEST_TIMEOUT_MS = 12_000;

export class LoaderGrabberOwnerError extends Schema.TaggedError<LoaderGrabberOwnerError>()(
  "LoaderGrabberOwnerError",
  {
    rendererId: Schema.Int,
  },
) {
  override get message(): string {
    return `The Loader grabber has no owning game: ${this.rendererId}`;
  }
}

const resolveOwningGame = Effect.fn(
  "desktop.ipc.loaderGrabber.resolveOwningGame",
)(function* (sender: DesktopIpcSender) {
  const windows = yield* DesktopWindows;
  const ownerRendererId = yield* windows.getOwnerRendererId(sender.rendererId);
  if (
    ownerRendererId === null ||
    (yield* windows.getRendererKind(ownerRendererId)) !== "game"
  ) {
    return yield* new LoaderGrabberOwnerError({
      rendererId: sender.rendererId,
    });
  }
  return ownerRendererId;
});

const requestOwningGame = Effect.fn("desktop.ipc.loaderGrabber.request")(
  function* <A>(
    sender: DesktopIpcSender,
    request: (
      client: GameRendererRpcClient,
    ) => Effect.Effect<A, LoaderGrabberError | RpcClientError>,
  ) {
    const rpc = yield* GameRendererRpc;
    const gameRendererId = yield* resolveOwningGame(sender);
    return yield* rpc.call(gameRendererId, request, {
      timeout: LOADER_GRABBER_REQUEST_TIMEOUT_MS,
    });
  },
);

export const load = makeDesktopIpcMethod({
  descriptor: LoaderGrabberIpc.load,
  allowedSenders: ["loader-grabber"],
  handler: (payload, sender) =>
    requestOwningGame(sender, (client) => client.LoaderGrabberLoad(payload)),
});

export const grab = makeDesktopIpcMethod({
  descriptor: LoaderGrabberIpc.grab,
  allowedSenders: ["loader-grabber"],
  handler: (payload, sender) =>
    requestOwningGame(sender, (client) => client.LoaderGrabberGrab(payload)),
});

export const methods = [load, grab] as const;
