import {
  normalizeFollowerConfig,
  type FollowerState,
} from "@lucent/core/follower";
import { Effect, Schema } from "effect";

import { FollowerIpc } from "../../../shared/ipc";
import {
  GameFollowerRequestError,
  GameFollowers,
} from "../../internal/follower/GameFollowers";
import { DesktopWindows } from "../../window/DesktopWindows";
import { DesktopIpc, makeDesktopIpcMethod } from "../DesktopIpc";
import type { DesktopIpcSender } from "../DesktopIpcSenders";

export class FollowerOwnerError extends Schema.TaggedErrorClass<FollowerOwnerError>()(
  "FollowerOwnerError",
  {
    browserWindowId: Schema.Int,
  },
) {
  override get message(): string {
    return `Follower window has no owning game: ${this.browserWindowId}`;
  }
}

const resolveGameBrowserWindowId = Effect.fn(
  "desktop.ipc.follower.resolveGame",
)(function* (sender: DesktopIpcSender) {
  if (sender.kind === "game") {
    return sender.browserWindowId;
  }

  const windows = yield* DesktopWindows;
  const ownerBrowserWindowId = yield* windows.getOwnerBrowserWindowId(
    sender.browserWindowId,
  );
  if (
    ownerBrowserWindowId === null ||
    (yield* windows.getBrowserWindowKind(ownerBrowserWindowId)) !== "game"
  ) {
    return yield* new FollowerOwnerError({
      browserWindowId: sender.browserWindowId,
    });
  }
  return ownerBrowserWindowId;
});

const notifyChanged = Effect.fn("desktop.ipc.follower.notifyChanged")(
  function* (
    gameBrowserWindowId: number,
    state: FollowerState,
    excludedBrowserWindowId?: number,
  ) {
    const ipc = yield* DesktopIpc;
    const windows = yield* DesktopWindows;
    const targets = (yield* windows.getOwnedBrowserWindowIds(
      gameBrowserWindowId,
      "follower",
    )).filter((browserWindowId) => browserWindowId !== excludedBrowserWindowId);
    yield* ipc.sendToBrowserWindowIds(targets, FollowerIpc.changed, state);
  },
);

const notifyPlayersChanged = Effect.fn(
  "desktop.ipc.follower.notifyPlayersChanged",
)(function* (gameBrowserWindowId: number, players: readonly string[]) {
  const ipc = yield* DesktopIpc;
  const windows = yield* DesktopWindows;
  const targets = yield* windows.getOwnedBrowserWindowIds(
    gameBrowserWindowId,
    "follower",
  );
  yield* ipc.sendToBrowserWindowIds(
    targets,
    FollowerIpc.playersChanged,
    players,
  );
});

const requestState = Effect.fn("desktop.ipc.follower.requestState")(function* (
  sender: DesktopIpcSender,
  input:
    | {
        readonly config: ReturnType<typeof normalizeFollowerConfig>;
        readonly kind: "configure";
      }
    | { readonly kind: "get-state" }
    | {
        readonly config: ReturnType<typeof normalizeFollowerConfig>;
        readonly kind: "start";
      }
    | { readonly kind: "stop" },
) {
  const followers = yield* GameFollowers;
  const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
  const outcome = yield* followers.request(gameBrowserWindowId, input);
  if (outcome.kind === "me") {
    return yield* new GameFollowerRequestError({
      detail: `Follower returned ${outcome.kind} for ${input.kind}.`,
    });
  }

  const state = yield* followers.set(gameBrowserWindowId, outcome.state);
  yield* notifyChanged(gameBrowserWindowId, state, sender.browserWindowId);
  return state;
});

export const configure = makeDesktopIpcMethod({
  descriptor: FollowerIpc.configure,
  allowedSenders: ["follower"],
  handler: (payload, sender) =>
    requestState(sender, {
      config: normalizeFollowerConfig(payload),
      kind: "configure",
    }),
});

export const getState = makeDesktopIpcMethod({
  descriptor: FollowerIpc.getState,
  allowedSenders: ["follower"],
  handler: Effect.fn("desktop.ipc.follower.getState")(
    function* (_payload, sender) {
      const followers = yield* GameFollowers;
      const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
      return yield* requestState(sender, { kind: "get-state" }).pipe(
        Effect.catchTag("GameFollowerRequestError", () =>
          followers.get(gameBrowserWindowId),
        ),
      );
    },
  ),
});

export const getPlayers = makeDesktopIpcMethod({
  descriptor: FollowerIpc.getPlayers,
  allowedSenders: ["follower"],
  handler: Effect.fn("desktop.ipc.follower.getPlayers")(
    function* (_payload, sender) {
      const followers = yield* GameFollowers;
      const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
      return yield* followers.getPlayers(gameBrowserWindowId);
    },
  ),
});

export const me = makeDesktopIpcMethod({
  descriptor: FollowerIpc.me,
  allowedSenders: ["follower"],
  handler: Effect.fn("desktop.ipc.follower.me")(function* (_payload, sender) {
    const followers = yield* GameFollowers;
    const gameBrowserWindowId = yield* resolveGameBrowserWindowId(sender);
    const outcome = yield* followers.request(gameBrowserWindowId, {
      kind: "me",
    });
    if (outcome.kind !== "me") {
      return yield* new GameFollowerRequestError({
        detail: `Follower returned ${outcome.kind} for me.`,
      });
    }
    return outcome.username;
  }),
});

export const start = makeDesktopIpcMethod({
  descriptor: FollowerIpc.start,
  allowedSenders: ["follower"],
  handler: (payload, sender) =>
    requestState(sender, {
      config: normalizeFollowerConfig(payload),
      kind: "start",
    }),
});

export const stop = makeDesktopIpcMethod({
  descriptor: FollowerIpc.stop,
  allowedSenders: ["follower"],
  handler: (_payload, sender) => requestState(sender, { kind: "stop" }),
});

export const respond = makeDesktopIpcMethod({
  descriptor: FollowerIpc.respond,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.follower.respond")(
    function* (response, sender) {
      const followers = yield* GameFollowers;
      yield* followers.respond(sender.browserWindowId, response);
    },
  ),
});

export const publishState = makeDesktopIpcMethod({
  descriptor: FollowerIpc.publishState,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.follower.publishState")(
    function* (incoming, sender) {
      const followers = yield* GameFollowers;
      const state = yield* followers.set(sender.browserWindowId, incoming);
      yield* notifyChanged(sender.browserWindowId, state);
    },
  ),
});

export const publishPlayers = makeDesktopIpcMethod({
  descriptor: FollowerIpc.publishPlayers,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.follower.publishPlayers")(
    function* (incoming, sender) {
      const followers = yield* GameFollowers;
      const update = yield* followers.setPlayers(
        sender.browserWindowId,
        incoming,
      );
      if (update.changed) {
        yield* notifyPlayersChanged(sender.browserWindowId, update.players);
      }
    },
  ),
});

export const methods = [
  configure,
  getPlayers,
  getState,
  me,
  start,
  stop,
  publishPlayers,
  respond,
  publishState,
] as const;
