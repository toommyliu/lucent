import { BrowserWindow, type WebContents } from "electron";
import { Effect } from "effect";
import {
  getWindowDefinition,
  isAppWindowDefinition,
  isGameChildWindowDefinition,
  WindowIds,
  type WindowId,
} from "../../shared/windows";
import {
  WindowManagerError,
  WindowService,
  type WindowStartupContext,
} from "../window/WindowService";

export interface SenderGameWindowIds {
  readonly senderWindowId: number;
  readonly gameWindowId: number;
}

export interface SenderGameWindow extends SenderGameWindowIds {
  readonly gameWindow: BrowserWindow;
}

export const getSenderWindow = (
  sender: WebContents,
): BrowserWindow | undefined =>
  BrowserWindow.fromWebContents(sender) ?? undefined;

export const getSenderWindowId = (sender: WebContents): number | undefined =>
  getSenderWindow(sender)?.id;

const requireSenderWindowId = (
  sender: WebContents,
): Effect.Effect<number, WindowManagerError> => {
  const senderWindowId = getSenderWindowId(sender);
  return senderWindowId === undefined
    ? Effect.fail(new WindowManagerError({ message: "Missing sender window" }))
    : Effect.succeed(senderWindowId);
};

export const getSenderGameWindowIds = (
  sender: WebContents,
): Effect.Effect<SenderGameWindowIds, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const senderWindowId = yield* requireSenderWindowId(sender);
    const windows = yield* WindowService;
    const gameWindowId = yield* windows.getGameWindowId(senderWindowId);
    if (gameWindowId === undefined) {
      return yield* new WindowManagerError({
        message: "Missing parent game window",
      });
    }

    return { gameWindowId, senderWindowId };
  });

export const getSenderGameWindow = (
  sender: WebContents,
): Effect.Effect<SenderGameWindow, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const ids = yield* getSenderGameWindowIds(sender);
    const windows = yield* WindowService;
    const gameWindow = yield* windows.getGameWindow(ids.gameWindowId);
    if (!gameWindow) {
      return yield* new WindowManagerError({
        message: "Missing parent game window",
      });
    }

    return { ...ids, gameWindow };
  });

export const getSenderWindowContext = (
  sender: WebContents,
): Effect.Effect<WindowStartupContext, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const senderWindowId = yield* requireSenderWindowId(sender);
    const windows = yield* WindowService;
    const context = yield* windows.getWindowContext(senderWindowId);
    if (context === undefined) {
      return yield* new WindowManagerError({
        message: "Unknown sender window context",
      });
    }

    return context;
  });

export const requireSenderWindowContext = (
  sender: WebContents,
  isAllowed: (context: WindowStartupContext) => boolean,
  message: string,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const context = yield* getSenderWindowContext(sender);
    if (!isAllowed(context)) {
      return yield* new WindowManagerError({ message });
    }
  });

export const requireAccountManagerSender = (
  sender: WebContents,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  requireSenderWindowContext(
    sender,
    (context) =>
      context.kind === "app" && context.id === WindowIds.AccountManager,
    "IPC sender must be the Account Manager window",
  );

export const requireGameWindowSender = (
  sender: WebContents,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  requireSenderWindowContext(
    sender,
    (context) => context.kind === "game",
    "IPC sender must be a game window",
  );

export const requireScriptingSender = (
  sender: WebContents,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  requireSenderWindowContext(
    sender,
    (context) =>
      context.kind === "game" ||
      (context.kind === "app" && context.id === WindowIds.AccountManager),
    "IPC sender cannot access scripting",
  );

export const requireWindowOpenSender = (
  sender: WebContents,
  targetWindowId: WindowId,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const context = yield* getSenderWindowContext(sender);
    const target = getWindowDefinition(targetWindowId);
    if (!target) {
      return yield* new WindowManagerError({
        message: `Unknown window: ${targetWindowId}`,
      });
    }

    if (isGameChildWindowDefinition(target)) {
      if (context.kind === "game" || context.kind === "game-child") {
        return;
      }

      return yield* new WindowManagerError({
        message: `Sender cannot open game tool window: ${targetWindowId}`,
      });
    }

    if (isAppWindowDefinition(target)) {
      if (context.kind === "app" || context.kind === "game") {
        return;
      }

      return yield* new WindowManagerError({
        message: `Sender cannot open app window: ${targetWindowId}`,
      });
    }

    return yield* new WindowManagerError({
      message: `Unsupported window definition: ${targetWindowId}`,
    });
  });
