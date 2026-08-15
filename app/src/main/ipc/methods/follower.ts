import {
  normalizeFollowerConfig,
  type FollowerState,
} from "@lucent/core/follower";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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
    rendererId: Schema.Int,
  },
) {
  override get message(): string {
    return `Follower window has no owning game: ${this.rendererId}`;
  }
}

const resolveGameRendererId = Effect.fn("desktop.ipc.follower.resolveGame")(
  function* (sender: DesktopIpcSender) {
    if (sender.kind === "game") {
      return sender.rendererId;
    }

    const windows = yield* DesktopWindows;
    const ownerRendererId = yield* windows.getOwnerRendererId(
      sender.rendererId,
    );
    if (
      ownerRendererId === null ||
      (yield* windows.getRendererKind(ownerRendererId)) !== "game"
    ) {
      return yield* new FollowerOwnerError({
        rendererId: sender.rendererId,
      });
    }
    return ownerRendererId;
  },
);

const notifyChanged = Effect.fn("desktop.ipc.follower.notifyChanged")(
  function* (
    gameRendererId: number,
    state: FollowerState,
    excludedRendererId?: number,
  ) {
    const ipc = yield* DesktopIpc;
    const windows = yield* DesktopWindows;
    const targets = (yield* windows.getOwnedRendererIds(
      gameRendererId,
      "follower",
    )).filter((rendererId) => rendererId !== excludedRendererId);
    yield* ipc.sendToRendererIds(targets, FollowerIpc.changed, state);
  },
);

const notifyPlayersChanged = Effect.fn(
  "desktop.ipc.follower.notifyPlayersChanged",
)(function* (gameRendererId: number, players: readonly string[]) {
  const ipc = yield* DesktopIpc;
  const windows = yield* DesktopWindows;
  const targets = yield* windows.getOwnedRendererIds(
    gameRendererId,
    "follower",
  );
  yield* ipc.sendToRendererIds(targets, FollowerIpc.playersChanged, players);
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
  const gameRendererId = yield* resolveGameRendererId(sender);
  const outcome = yield* followers.request(gameRendererId, input);
  if (outcome.kind === "me") {
    return yield* new GameFollowerRequestError({
      detail: `Follower returned ${outcome.kind} for ${input.kind}.`,
    });
  }

  const state = yield* followers.set(gameRendererId, outcome.state);
  yield* notifyChanged(gameRendererId, state, sender.rendererId);
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

export const getConfig = makeDesktopIpcMethod({
  descriptor: FollowerIpc.getConfig,
  allowedSenders: ["follower"],
  handler: Effect.fn("desktop.ipc.follower.getConfig")(
    function* (_payload, sender) {
      const followers = yield* GameFollowers;
      const gameRendererId = yield* resolveGameRendererId(sender);
      return yield* followers.getConfig(gameRendererId);
    },
  ),
});

export const getState = makeDesktopIpcMethod({
  descriptor: FollowerIpc.getState,
  allowedSenders: ["follower"],
  handler: Effect.fn("desktop.ipc.follower.getState")(
    function* (_payload, sender) {
      const followers = yield* GameFollowers;
      const gameRendererId = yield* resolveGameRendererId(sender);
      return yield* requestState(sender, { kind: "get-state" }).pipe(
        Effect.catchTag("GameFollowerRequestError", () =>
          followers.get(gameRendererId),
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
      const gameRendererId = yield* resolveGameRendererId(sender);
      return yield* followers.getPlayers(gameRendererId);
    },
  ),
});

export const me = makeDesktopIpcMethod({
  descriptor: FollowerIpc.me,
  allowedSenders: ["follower"],
  handler: Effect.fn("desktop.ipc.follower.me")(function* (_payload, sender) {
    const followers = yield* GameFollowers;
    const gameRendererId = yield* resolveGameRendererId(sender);
    const outcome = yield* followers.request(gameRendererId, {
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
      yield* followers.respond(sender.rendererId, response);
    },
  ),
});

export const publishState = makeDesktopIpcMethod({
  descriptor: FollowerIpc.publishState,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.follower.publishState")(
    function* (incoming, sender) {
      const followers = yield* GameFollowers;
      const state = yield* followers.set(sender.rendererId, incoming);
      yield* notifyChanged(sender.rendererId, state);
    },
  ),
});

export const publishPlayers = makeDesktopIpcMethod({
  descriptor: FollowerIpc.publishPlayers,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.follower.publishPlayers")(
    function* (incoming, sender) {
      const followers = yield* GameFollowers;
      const update = yield* followers.setPlayers(sender.rendererId, incoming);
      if (update.changed) {
        yield* notifyPlayersChanged(sender.rendererId, update.players);
      }
    },
  ),
});

export const methods = [
  configure,
  getConfig,
  getPlayers,
  getState,
  me,
  start,
  stop,
  publishPlayers,
  respond,
  publishState,
] as const;
