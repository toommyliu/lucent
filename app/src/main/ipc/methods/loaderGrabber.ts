import { Effect, Schema } from "effect";

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
    browserWindowId: Schema.Int,
  },
) {
  override get message(): string {
    return `The Loader grabber has no owning game: ${this.browserWindowId}`;
  }
}

const resolveOwningGame = Effect.fn(
  "desktop.ipc.loaderGrabber.resolveOwningGame",
)(function* (sender: DesktopIpcSender) {
  const windows = yield* DesktopWindows;
  const ownerBrowserWindowId = yield* windows.getOwnerBrowserWindowId(
    sender.browserWindowId,
  );
  if (
    ownerBrowserWindowId === null ||
    (yield* windows.getBrowserWindowKind(ownerBrowserWindowId)) !== "game"
  ) {
    return yield* new LoaderGrabberOwnerError({
      browserWindowId: sender.browserWindowId,
    });
  }
  return ownerBrowserWindowId;
});

export const load = makeDesktopIpcMethod({
  descriptor: LoaderGrabberIpc.load,
  allowedSenders: ["loader-grabber"],
  handler: Effect.fn("desktop.ipc.loaderGrabber.load")(
    function* (payload, sender) {
      const loaderGrabbers = yield* GameLoaderGrabbers;
      const gameBrowserWindowId = yield* resolveOwningGame(sender);
      const outcome = yield* loaderGrabbers.request(gameBrowserWindowId, {
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
      const gameBrowserWindowId = yield* resolveOwningGame(sender);
      const outcome = yield* loaderGrabbers.request(gameBrowserWindowId, {
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
      yield* loaderGrabbers.respond(sender.browserWindowId, response);
    },
  ),
});

export const methods = [load, grab, respond] as const;
