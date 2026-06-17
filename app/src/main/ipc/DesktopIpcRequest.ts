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
  MissingParentGameWindowError,
  WindowOperationError,
  WindowSenderAuthorizationError,
  WindowService,
  type GameWindowRef,
  type WindowManagerError,
  type WindowStartupContext,
} from "../window/WindowService";

export interface SenderGameWindowIds {
  readonly senderWindowId: number;
  readonly gameWindowId: number;
}

export interface SenderGameWindow extends SenderGameWindowIds {
  readonly gameWindow: GameWindowRef;
}

export type DesktopIpcCapability =
  | "account-manager"
  | "game-window"
  | "scripting";

export interface DesktopIpcRequest {
  readonly sender: WebContents;
  readonly senderWindowId: number;
  readonly context: WindowStartupContext;
  readonly hasCapability: (capability: DesktopIpcCapability) => boolean;
  readonly requireCapability: (
    capability: DesktopIpcCapability,
    message: string,
  ) => Effect.Effect<void, WindowManagerError>;
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
    ? Effect.fail(
        new WindowOperationError({ message: "Missing sender window" }),
      )
    : Effect.succeed(senderWindowId);
};

export const getSenderGameWindowIds = (
  sender: WebContents,
): Effect.Effect<SenderGameWindowIds, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const senderWindowId = yield* requireSenderWindowId(sender);
    const windows = yield* WindowService;
    const gameWindow = yield* windows.getGameWindowRef(senderWindowId);
    if (gameWindow === undefined) {
      return yield* new MissingParentGameWindowError({
        message: "Missing parent game window",
      });
    }

    return { gameWindowId: gameWindow.id, senderWindowId };
  });

export const getSenderGameWindow = (
  sender: WebContents,
): Effect.Effect<SenderGameWindow, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const senderWindowId = yield* requireSenderWindowId(sender);
    const windows = yield* WindowService;
    const gameWindow = yield* windows.getGameWindowRef(senderWindowId);
    if (!gameWindow) {
      return yield* new MissingParentGameWindowError({
        message: "Missing parent game window",
      });
    }

    return { gameWindow, gameWindowId: gameWindow.id, senderWindowId };
  });

export const getSenderWindowContext = (
  sender: WebContents,
): Effect.Effect<WindowStartupContext, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const senderWindowId = yield* requireSenderWindowId(sender);
    const windows = yield* WindowService;
    const context = yield* windows.getWindowContext(senderWindowId);
    if (context === undefined) {
      return yield* new WindowOperationError({
        message: "Unknown sender window context",
      });
    }

    return context;
  });

export const hasDesktopIpcCapability = (
  context: WindowStartupContext,
  capability: DesktopIpcCapability,
): boolean => {
  switch (capability) {
    case "account-manager": {
      return context.kind === "app" && context.id === WindowIds.AccountManager;
    }
    case "game-window": {
      return context.kind === "game";
    }
    case "scripting": {
      return (
        context.kind === "game" ||
        (context.kind === "app" && context.id === WindowIds.AccountManager)
      );
    }
  }
};

export const makeDesktopIpcRequest = (
  sender: WebContents,
): Effect.Effect<DesktopIpcRequest, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const senderWindowId = yield* requireSenderWindowId(sender);
    const context = yield* getSenderWindowContext(sender);
    const hasCapability = (capability: DesktopIpcCapability): boolean =>
      hasDesktopIpcCapability(context, capability);

    return {
      context,
      hasCapability,
      sender,
      senderWindowId,
      requireCapability: (capability, message) =>
        hasCapability(capability)
          ? Effect.void
          : Effect.fail(new WindowSenderAuthorizationError({ message })),
    };
  });

export const requireSenderWindowContext = (
  sender: WebContents,
  isAllowed: (context: WindowStartupContext) => boolean,
  message: string,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const request = yield* makeDesktopIpcRequest(sender);
    if (!isAllowed(request.context)) {
      return yield* new WindowSenderAuthorizationError({ message });
    }
  });

export const requireAccountManagerSender = (
  sender: WebContents,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  makeDesktopIpcRequest(sender).pipe(
    Effect.flatMap((request) =>
      request.requireCapability(
        "account-manager",
        "IPC sender must be the Account Manager window",
      ),
    ),
  );

export const requireGameWindowSender = (
  sender: WebContents,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  makeDesktopIpcRequest(sender).pipe(
    Effect.flatMap((request) =>
      request.requireCapability(
        "game-window",
        "IPC sender must be a game window",
      ),
    ),
  );

export const requireScriptingSender = (
  sender: WebContents,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  makeDesktopIpcRequest(sender).pipe(
    Effect.flatMap((request) =>
      request.requireCapability(
        "scripting",
        "IPC sender cannot access scripting",
      ),
    ),
  );

export const requireWindowOpenSender = (
  sender: WebContents,
  targetWindowId: WindowId,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const context = yield* getSenderWindowContext(sender);
    const target = getWindowDefinition(targetWindowId);
    if (!target) {
      return yield* new WindowOperationError({
        message: `Unknown window: ${targetWindowId}`,
      });
    }

    if (isGameChildWindowDefinition(target)) {
      if (context.kind === "game" || context.kind === "game-child") {
        return;
      }

      return yield* new WindowSenderAuthorizationError({
        message: `Sender cannot open game tool window: ${targetWindowId}`,
      });
    }

    if (isAppWindowDefinition(target)) {
      if (context.kind === "app" || context.kind === "game") {
        return;
      }

      return yield* new WindowSenderAuthorizationError({
        message: `Sender cannot open app window: ${targetWindowId}`,
      });
    }

    return yield* new WindowOperationError({
      message: `Unsupported window definition: ${targetWindowId}`,
    });
  });
