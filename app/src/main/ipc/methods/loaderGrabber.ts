import type { IpcMainInvokeEvent } from "electron";
import { Effect, Scope } from "effect";
import {
  type GrabbedData,
  type LoaderGrabberGrabRequest,
  type LoaderGrabberLoadRequest,
} from "../../../shared/loader-grabber";
import {
  LoaderGrabberIpcContracts,
  LoaderGrabberIpcChannels,
  type LoaderGrabberRequestKind,
  type LoaderGrabberRequestMessage,
  type LoaderGrabberResponseMessage,
} from "../../../shared/ipc";
import {
  WindowManagerError,
  WindowOperationError,
  type GameWindowRef,
  type WindowEffectRunner,
  type WindowService,
} from "../../window/WindowService";
import {
  GameWindowClient,
  type GameWindowClientShape,
} from "../../window/GameWindowClient";
import { DesktopIpc } from "../DesktopIpc";
import {
  getSenderGameWindow,
  requireGameWindowSender,
} from "../DesktopIpcRequest";

const LOADER_GRABBER_REQUEST_TIMEOUT_MS = 5_000;

const requestErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Loader grabber request failed";

const makeRequestMessage = (
  requestId: string,
  kind: LoaderGrabberRequestKind,
  payload: LoaderGrabberLoadRequest | LoaderGrabberGrabRequest,
): LoaderGrabberRequestMessage =>
  kind === "load"
    ? {
        kind,
        payload: payload as LoaderGrabberLoadRequest,
        requestId,
      }
    : {
        kind,
        payload: payload as LoaderGrabberGrabRequest,
        requestId,
      };

const requestGameLoaderGrabber = (
  gameClient: GameWindowClientShape,
  gameWindow: GameWindowRef,
  kind: LoaderGrabberRequestKind,
  payload: LoaderGrabberLoadRequest | LoaderGrabberGrabRequest,
): Effect.Effect<
  GrabbedData | null,
  Error | WindowManagerError,
  WindowService
> =>
  gameClient.request({
    target: gameWindow,
    requestChannel: LoaderGrabberIpcChannels.request,
    timeoutMs: LOADER_GRABBER_REQUEST_TIMEOUT_MS,
    timeoutError: "Loader grabber did not respond",
    sendError: "Loader grabber request failed",
    makeMessage: (requestId) => makeRequestMessage(requestId, kind, payload),
  });

const sendLoaderGrabberRequest = (
  event: IpcMainInvokeEvent,
  gameClient: GameWindowClientShape,
  kind: LoaderGrabberRequestKind,
  payload: LoaderGrabberLoadRequest | LoaderGrabberGrabRequest,
): Effect.Effect<GrabbedData | null, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindow } = yield* getSenderGameWindow(event.sender);

    return yield* requestGameLoaderGrabber(
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
    );
  });

export const registerLoaderGrabberIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<void, never, GameWindowClient | DesktopIpc | Scope.Scope> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;
    const gameClient = yield* GameWindowClient;
    const run = <A>(
      effect: Effect.Effect<A, WindowManagerError, WindowService>,
    ) => Effect.promise(() => runWindowEffect(effect));

    yield* ipc.on(LoaderGrabberIpcChannels.response, (event, response) =>
      run(
        Effect.gen(function* () {
          yield* requireGameWindowSender(event.sender);
          const loaderGrabberResponse = response as Partial<
            LoaderGrabberResponseMessage & {
              readonly error?: unknown;
              readonly value?: unknown;
            }
          >;
          if (typeof loaderGrabberResponse?.requestId !== "string") {
            return;
          }

          if (typeof loaderGrabberResponse.ok !== "boolean") {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              loaderGrabberResponse.requestId,
              gameWindow,
              new Error("Invalid loader grabber response"),
            );
            return;
          }

          if (loaderGrabberResponse.ok) {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              loaderGrabberResponse.requestId,
              gameWindow,
              loaderGrabberResponse.value ?? null,
            );
            return;
          }

          const message =
            typeof loaderGrabberResponse.error === "string" &&
            loaderGrabberResponse.error !== ""
              ? loaderGrabberResponse.error
              : "Loader grabber request failed";
          const { gameWindow } = yield* getSenderGameWindow(event.sender);
          yield* gameClient.resolve(
            loaderGrabberResponse.requestId,
            gameWindow,
            new Error(message),
          );
        }),
      ),
    );

    yield* ipc.handleContract(
      LoaderGrabberIpcContracts.load,
      (event, payload) =>
        Effect.asVoid(
          run(sendLoaderGrabberRequest(event, gameClient, "load", payload)),
        ),
    );

    yield* ipc.handleContract(
      LoaderGrabberIpcContracts.grab,
      (event, payload) =>
        run(sendLoaderGrabberRequest(event, gameClient, "grab", payload)),
    );
  });
