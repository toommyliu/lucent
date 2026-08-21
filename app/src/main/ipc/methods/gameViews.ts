import * as Effect from "effect/Effect";

import {
  isValidGameViewGroupTargetSnapshot,
  resolveGameViewGroupTargets,
  type GameViewGroupCommand,
  type GameViewGroupCommandEnvelope,
} from "../../../shared/gameViews";
import { GameViewsIpc } from "../../../shared/ipc";
import { DesktopScriptLibrary } from "../../scripting/DesktopScriptLibrary";
import {
  DesktopWindowError,
  DesktopWindows,
} from "../../window/DesktopWindows";
import { DesktopIpc, makeDesktopIpcMethod } from "../DesktopIpc";

const hostSenders = ["game-group-controls", "game-host"] as const;
const gameHostSenders = ["game-host"] as const;
const gameSenders = ["game"] as const;
const GROUP_LOGIN_STAGGER_MS = 650;

export const getState = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.getState,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.getState")(
    function* (_payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.getGameViewHostState(sender.rendererId);
    },
  ),
});

export const add = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.add,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.add")(function* (_payload, sender) {
    const windows = yield* DesktopWindows;
    return yield* windows.addGameView(sender.rendererId);
  }),
});

export const select = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.select,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.select")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.selectGameView(
        sender.rendererId,
        payload.id,
        payload.focus,
      );
    },
  ),
});

export const close = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.close,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.close")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.closeGameView(sender.rendererId, payload.id);
    },
  ),
});

export const reorder = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.reorder,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.reorder")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.reorderGameViews(sender.rendererId, payload.ids);
    },
  ),
});

export const setLayout = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.setLayout,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.setLayout")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.setGameViewLayout(
        sender.rendererId,
        payload.layout,
      );
    },
  ),
});

export const setGroupControlsOpen = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.setGroupControlsOpen,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.setGroupControlsOpen")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.setGameViewGroupControlsOpen(
        sender.rendererId,
        payload.open,
      );
    },
  ),
});

export const setTabMenuOpen = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.setTabMenuOpen,
  allowedSenders: gameHostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.setTabMenuOpen")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.setGameViewTabMenuOpen(
        sender.rendererId,
        payload.open,
      );
    },
  ),
});

export const syncTabBarLayout = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.syncTabBarLayout,
  allowedSenders: gameHostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.syncTabBarLayout")(
    function* (_payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.syncGameViewTabBarLayout(sender.rendererId);
    },
  ),
});

export const setGroupTargets = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.setGroupTargets,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.setGroupTargets")(
    function* (payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.setGameViewGroupTargets(
        sender.rendererId,
        payload.ids,
      );
    },
  ),
});

export const dispatchGroupCommand = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.dispatchGroupCommand,
  allowedSenders: hostSenders,
  handler: Effect.fn("desktop.ipc.gameViews.dispatchGroupCommand")(
    function* (request, sender) {
      const ipc = yield* DesktopIpc;
      const windows = yield* DesktopWindows;
      const state = yield* windows.getGameViewHostState(sender.rendererId);
      if (!isValidGameViewGroupTargetSnapshot(state, request.targetIds)) {
        return yield* new DesktopWindowError({
          detail:
            "Group command targets must be unique tabs in this game window.",
          id: String(sender.rendererId),
        });
      }
      let { readySessions, skippedCount } = resolveGameViewGroupTargets(
        state,
        request.targetIds,
      );
      let rendererIds = yield* Effect.forEach(readySessions, (session) =>
        windows.getRendererId(session.id),
      );

      if (rendererIds.length === 0) {
        return {
          recipientCount: 0,
          skippedCount,
          status: "sent" as const,
        };
      }

      let command: GameViewGroupCommand;
      if (request.command.kind === "load-script") {
        const scripts = yield* DesktopScriptLibrary;
        const result = yield* windows.withGameViewGroupControlsNativeDialog(
          sender.rendererId,
          (parentWindowId) => scripts.openFile(parentWindowId),
        );
        if (result.canceled) {
          return {
            recipientCount: 0,
            skippedCount,
            status: "canceled" as const,
          };
        }
        command = { file: result.file, kind: "load-script" };

        // Native file selection can outlive a tab or renderer generation.
        // Re-resolve the captured target IDs immediately before delivery.
        const latestState = yield* windows.getGameViewHostState(
          sender.rendererId,
        );
        ({ readySessions, skippedCount } = resolveGameViewGroupTargets(
          latestState,
          request.targetIds,
        ));
        rendererIds = yield* Effect.forEach(readySessions, (session) =>
          windows.getRendererId(session.id),
        );
        if (rendererIds.length === 0) {
          return {
            recipientCount: 0,
            skippedCount,
            status: "sent" as const,
          };
        }
      } else {
        command = request.command;
      }

      if (command.kind === "login") {
        // Queue every login immediately while spacing network submissions
        // enough to avoid tripping AQW's multi-login rate limiting.
        yield* Effect.forEach(
          rendererIds,
          (rendererId, index) => {
            const envelope: GameViewGroupCommandEnvelope = {
              command,
              delayMs: index * GROUP_LOGIN_STAGGER_MS,
            };
            return ipc.sendToRendererIds(
              [rendererId],
              GameViewsIpc.groupCommand,
              envelope,
            );
          },
          { discard: true },
        );
      } else {
        const envelope: GameViewGroupCommandEnvelope = {
          command,
          delayMs: 0,
        };
        yield* ipc.sendToRendererIds(
          rendererIds,
          GameViewsIpc.groupCommand,
          envelope,
        );
      }

      return {
        recipientCount: rendererIds.length,
        skippedCount,
        status: "sent" as const,
      };
    },
  ),
});

export const getPresentation = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.getPresentation,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.gameViews.getPresentation")(
    function* (_payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.getGameViewPresentation(sender.rendererId);
    },
  ),
});

export const activate = makeDesktopIpcMethod({
  descriptor: GameViewsIpc.activate,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.gameViews.activate")(
    function* (_payload, sender) {
      const windows = yield* DesktopWindows;
      return yield* windows.activateGameView(sender.rendererId);
    },
  ),
});

export const methods = [
  getState,
  add,
  select,
  close,
  reorder,
  setLayout,
  setGroupTargets,
  setGroupControlsOpen,
  setTabMenuOpen,
  syncTabBarLayout,
  dispatchGroupCommand,
  getPresentation,
  activate,
] as const;
