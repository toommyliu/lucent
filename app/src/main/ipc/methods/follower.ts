import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
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
  WindowService,
  type WindowEffectRunner,
} from "../../window/WindowService";
import {
  makeGameWindowRequestBroker,
  type GameWindowRequestBroker,
} from "../GameWindowRequestBroker";
import { MainIpc } from "../MainIpc";
import {
  getSenderGameWindow,
  getSenderGameWindowIds,
  requireGameWindowSender,
} from "../SenderAuthorization";
import {
  FollowerRuntimeService,
  type FollowerRuntimeServiceShape,
} from "../runtime/FollowerRuntimeService";

const FOLLOWER_REQUEST_TIMEOUT_MS = 5_000;

const requestErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Follower request failed";

const sendChanged = (
  window: BrowserWindow | null,
  senderWindowId: number | undefined,
  state: FollowerState,
): void => {
  if (
    !window ||
    window.id === senderWindowId ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return;
  }

  window.webContents.send(FollowerIpcChannels.changed, state);
};

const notifyFollowerChanged = (
  gameWindowId: number,
  senderWindowId: number | undefined,
  state: FollowerState,
): Effect.Effect<void, never, WindowService> =>
  Effect.gen(function* () {
    const windows = yield* WindowService;
    const gameWindow = yield* windows.getGameWindow(gameWindowId);
    const followerWindow = yield* windows.getGameChildWindow(
      gameWindowId,
      WindowIds.Follower,
    );

    sendChanged(gameWindow, senderWindowId, state);
    sendChanged(followerWindow, senderWindowId, state);
  });

const requestGameFollower = (
  broker: GameWindowRequestBroker<unknown>,
  gameWindow: BrowserWindow,
  kind: FollowerRequestKind,
  payload?: unknown,
): Promise<unknown> =>
  broker.request({
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
  broker: GameWindowRequestBroker<unknown>,
  runtime: FollowerRuntimeServiceShape,
  kind: FollowerRequestKind,
  payload?: unknown,
): Effect.Effect<FollowerState, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindow, gameWindowId, senderWindowId } =
      yield* getSenderGameWindow(event.sender);

    const rawState = yield* Effect.tryPromise({
      try: () => requestGameFollower(broker, gameWindow, kind, payload),
      catch: (cause) =>
        new WindowManagerError({
          message: requestErrorMessage(cause),
          cause,
        }),
    }).pipe(
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
): Effect.Effect<void, never, FollowerRuntimeService | MainIpc | Scope.Scope> =>
  Effect.gen(function* () {
    const ipc = yield* MainIpc;
    const runtime: FollowerRuntimeServiceShape = yield* FollowerRuntimeService;
    const broker = makeGameWindowRequestBroker<unknown>();
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
            broker.resolve(followerResponse.requestId, followerResponse.value);
          } else {
            broker.resolve(
              followerResponse.requestId,
              new Error(followerResponse.error || "Follower request failed"),
            );
          }
        }),
      ),
    );

    yield* ipc.handle(FollowerIpcChannels.getState, (event) =>
      run(requestFollowerState(event, broker, runtime, "getState")),
    );

    yield* ipc.handle(FollowerIpcChannels.me, (event) =>
      run(
        Effect.gen(function* () {
          const { gameWindow } = yield* getSenderGameWindow(event.sender);

          return yield* Effect.tryPromise({
            try: () => requestGameFollower(broker, gameWindow, "me"),
            catch: (cause) =>
              new WindowManagerError({
                message: requestErrorMessage(cause),
                cause,
              }),
          }).pipe(Effect.map((name) => (typeof name === "string" ? name : "")));
        }),
      ),
    );

    yield* ipc.handle(FollowerIpcChannels.start, (event, payload) =>
      run(
        requestFollowerState(
          event,
          broker,
          runtime,
          "start",
          normalizeFollowerConfig(payload as FollowerStartPayload),
        ),
      ),
    );

    yield* ipc.handle(FollowerIpcChannels.stop, (event) =>
      run(requestFollowerState(event, broker, runtime, "stop")),
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

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        broker.rejectAll(new Error("Follower IPC scope closed"));
      }),
    );
  });
