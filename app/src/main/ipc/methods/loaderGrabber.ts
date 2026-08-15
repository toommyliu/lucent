import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { LoaderGrabberIpc } from "../../../shared/ipc";
import {
  GameLoaderGrabbers,
  LoaderGrabberRequestError,
} from "../../internal/loader-grabber/GameLoaderGrabbers";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeDesktopIpcMethod } from "../DesktopIpc";
import type { DesktopIpcSender } from "../DesktopIpcSenders";

export class LoaderGrabberOwnerError extends Schema.TaggedErrorClass<LoaderGrabberOwnerError>()(
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

export const load = makeDesktopIpcMethod({
  descriptor: LoaderGrabberIpc.load,
  allowedSenders: ["loader-grabber"],
  handler: Effect.fn("desktop.ipc.loaderGrabber.load")(
    function* (payload, sender) {
      const loaderGrabbers = yield* GameLoaderGrabbers;
      const gameRendererId = yield* resolveOwningGame(sender);
      const outcome = yield* loaderGrabbers.request(gameRendererId, {
        kind: "load",
        payload,
      });
      if (outcome.kind !== "load") {
        return yield* new LoaderGrabberRequestError({
          detail: `The game returned ${outcome.kind} for a load request.`,
        });
      }
    },
  ),
});

export const grab = makeDesktopIpcMethod({
  descriptor: LoaderGrabberIpc.grab,
  allowedSenders: ["loader-grabber"],
  handler: Effect.fn("desktop.ipc.loaderGrabber.grab")(
    function* (payload, sender) {
      const loaderGrabbers = yield* GameLoaderGrabbers;
      const gameRendererId = yield* resolveOwningGame(sender);
      const outcome = yield* loaderGrabbers.request(gameRendererId, {
        kind: "grab",
        payload,
      });
      if (outcome.kind !== "grab") {
        return yield* new LoaderGrabberRequestError({
          detail: `The game returned ${outcome.kind} for a grab request.`,
        });
      }
      return outcome.value;
    },
  ),
});

export const respond = makeDesktopIpcMethod({
  descriptor: LoaderGrabberIpc.respond,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.loaderGrabber.respond")(
    function* (response, sender) {
      const loaderGrabbers = yield* GameLoaderGrabbers;
      yield* loaderGrabbers.respond(sender.rendererId, response);
    },
  ),
});

export const methods = [load, grab, respond] as const;
