import type { IpcMainInvokeEvent } from "electron";
import { Effect, Scope } from "effect";
import {
  normalizeFollowerConfig,
  normalizeFollowerState,
  type FollowerStartPayload,
  type FollowerState,
} from "../../../shared/follower";
import {
  FollowerIpcChannels,
  type FollowerRequestKind,
  type FollowerRequestMessage,
  type FollowerResponseMessage,
} from "../../../shared/ipc";
import { WindowIds } from "../../../shared/windows";
import {
  WindowManagerError,
  WindowOperationError,
  WindowService,
  type GameWindowRef,
  type WindowEffectRunner,
} from "../../window/WindowService";
import {
  GameWindowClient,
  type GameWindowClientShape,
} from "../../window/GameWindowClient";
import { DesktopIpc } from "../DesktopIpc";
import {
  getSenderGameWindow,
  getSenderGameWindowIds,
  requireGameWindowSender,
} from "../DesktopIpcRequest";
import {
  FollowerStateStore,
  type FollowerStateStoreShape,
} from "../../backend/follower/FollowerStateStore";

const FOLLOWER_REQUEST_TIMEOUT_MS = 5_000;

const requestErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Follower request failed";

const notifyFollowerChanged = (
  gameWindowId: number,
  senderWindowId: number | undefined,
  state: FollowerState,
): Effect.Effect<void, never, WindowService> =>
  Effect.gen(function* () {
    const windows = yield* WindowService;
    const gameWindow = yield* windows.getGameWindowRefById(gameWindowId);
    const followerWindow = yield* windows.getGameChildWindowRef(
      gameWindowId,
      WindowIds.Follower,
    );

    if (gameWindow && gameWindow.id !== senderWindowId) {
      yield* windows
        .sendToWindow(gameWindow, FollowerIpcChannels.changed, state)
        .pipe(Effect.ignore);
    }
    if (followerWindow && followerWindow.windowId !== senderWindowId) {
      yield* windows
        .sendToWindow(followerWindow, FollowerIpcChannels.changed, state)
        .pipe(Effect.ignore);
    }
  });

const requestGameFollower = (
  gameClient: GameWindowClientShape,
  gameWindow: GameWindowRef,
  kind: FollowerRequestKind,
  payload?: unknown,
): Effect.Effect<unknown, Error | WindowManagerError, WindowService> =>
  gameClient.request({
    target: gameWindow,
    requestChannel: FollowerIpcChannels.request,
    timeoutMs: FOLLOWER_REQUEST_TIMEOUT_MS,
    timeoutError: "Follower did not respond",
    sendError: "Follower request failed",
    makeMessage: (requestId): FollowerRequestMessage => ({
      requestId,
      kind,
      ...(payload === undefined ? {} : { payload }),
    }),
  });

const requestFollowerState = (
  event: IpcMainInvokeEvent,
  gameClient: GameWindowClientShape,
  runtime: FollowerStateStoreShape,
  kind: FollowerRequestKind,
  payload?: unknown,
): Effect.Effect<FollowerState, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindow, gameWindowId, senderWindowId } =
      yield* getSenderGameWindow(event.sender);

    const rawState = yield* requestGameFollower(
      gameClient,
      gameWindow,
      kind,
      payload,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new WindowOperationError({
            message: requestErrorMessage(cause),
            cause,
          }),
      ),
      Effect.catch((error: WindowManagerError) =>
        kind === "getState"
          ? Effect.succeed(runtime.getWindowState(gameWindowId))
          : Effect.fail(error),
      ),
    );
    const state = runtime.setWindowState(
      gameWindowId,
      normalizeFollowerState(rawState),
    );
    yield* notifyFollowerChanged(gameWindowId, senderWindowId, state);
    return state;
  });

export const registerFollowerIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<
  void,
  never,
  FollowerStateStore | GameWindowClient | DesktopIpc | Scope.Scope
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;
    const gameClient = yield* GameWindowClient;
    const runtime: FollowerStateStoreShape = yield* FollowerStateStore;
    const run = <A>(
      effect: Effect.Effect<A, WindowManagerError, WindowService>,
    ) => Effect.promise(() => runWindowEffect(effect));

    yield* ipc.on(FollowerIpcChannels.response, (event, response) =>
      run(
        Effect.gen(function* () {
          yield* requireGameWindowSender(event.sender);
          const followerResponse = response as FollowerResponseMessage;
          if (typeof followerResponse.requestId !== "string") {
            return;
          }

          if (followerResponse.ok) {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              followerResponse.requestId,
              gameWindow,
              followerResponse.value,
            );
          } else {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              followerResponse.requestId,
              gameWindow,
              new Error(followerResponse.error || "Follower request failed"),
            );
          }
        }),
      ),
    );

    yield* ipc.handle(FollowerIpcChannels.getState, (event) =>
      run(requestFollowerState(event, gameClient, runtime, "getState")),
    );

    yield* ipc.handle(FollowerIpcChannels.me, (event) =>
      run(
        Effect.gen(function* () {
          const { gameWindow } = yield* getSenderGameWindow(event.sender);

          return yield* requestGameFollower(gameClient, gameWindow, "me").pipe(
            Effect.mapError(
              (cause) =>
                new WindowOperationError({
                  message: requestErrorMessage(cause),
                  cause,
                }),
            ),
            Effect.map((name) => (typeof name === "string" ? name : "")),
          );
        }),
      ),
    );

    yield* ipc.handle(FollowerIpcChannels.start, (event, payload) =>
      run(
        requestFollowerState(
          event,
          gameClient,
          runtime,
          "start",
          normalizeFollowerConfig(payload as FollowerStartPayload),
        ),
      ),
    );

    yield* ipc.handle(FollowerIpcChannels.stop, (event) =>
      run(requestFollowerState(event, gameClient, runtime, "stop")),
    );

    yield* ipc.handle(FollowerIpcChannels.publishState, (event, rawState) =>
      run(
        Effect.gen(function* () {
          const { gameWindowId, senderWindowId } =
            yield* getSenderGameWindowIds(event.sender);
          const state = runtime.setWindowState(
            gameWindowId,
            normalizeFollowerState(rawState),
          );
          yield* notifyFollowerChanged(gameWindowId, senderWindowId, state);
        }),
      ),
    );
  });
