import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { Effect, Scope } from "effect";
import {
  addFastTravel,
  deleteFastTravel,
  normalizeFastTravelDraft,
  updateFastTravel,
  type FastTravel,
  type FastTravelDraft,
  type FastTravelWarpPayload,
} from "../../../shared/fast-travels";
import {
  FastTravelsIpcContracts,
  FastTravelsIpcChannels,
  type FastTravelsRequestMessage,
  type FastTravelsResponseMessage,
} from "../../../shared/ipc";
import {
  FastTravelRepository,
  type FastTravelRepositoryShape,
} from "../../backend/fast-travels/FastTravelRepository";
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

const FAST_TRAVELS_REQUEST_TIMEOUT_MS = 5_000;

const requestErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Fast travel request failed";

const broadcastChanged = (locations: readonly FastTravel[]): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      continue;
    }

    try {
      win.webContents.send(FastTravelsIpcChannels.changed, locations);
    } catch {}
  }
};

const publishLocations = (
  repository: FastTravelRepositoryShape,
  update: (current: readonly FastTravel[]) => readonly FastTravel[],
) =>
  repository
    .update(update)
    .pipe(
      Effect.tap((normalized) =>
        Effect.sync(() => broadcastChanged(normalized)),
      ),
    );

const requestGameFastTravel = (
  gameClient: GameWindowClientShape,
  gameWindow: GameWindowRef,
  payload: FastTravelWarpPayload,
): Effect.Effect<void, Error | WindowManagerError, WindowService> =>
  gameClient.request({
    target: gameWindow,
    requestChannel: FastTravelsIpcChannels.request,
    timeoutMs: FAST_TRAVELS_REQUEST_TIMEOUT_MS,
    timeoutError: "Fast travel did not respond",
    sendError: "Fast travel request failed",
    makeMessage: (requestId): FastTravelsRequestMessage => ({
      requestId,
      kind: "warp",
      payload,
    }),
  });

const sendFastTravelRequest = (
  event: IpcMainInvokeEvent,
  gameClient: GameWindowClientShape,
  payload: FastTravelWarpPayload,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindow } = yield* getSenderGameWindow(event.sender);

    return yield* requestGameFastTravel(gameClient, gameWindow, payload).pipe(
      Effect.mapError(
        (cause) =>
          new WindowOperationError({
            message: requestErrorMessage(cause),
            cause,
          }),
      ),
    );
  });

export const registerFastTravelsIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<
  void,
  never,
  FastTravelRepository | GameWindowClient | DesktopIpc | Scope.Scope
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;
    const gameClient = yield* GameWindowClient;
    const run = <A>(
      effect: Effect.Effect<A, WindowManagerError, WindowService>,
    ) => Effect.promise(() => runWindowEffect(effect));

    yield* ipc.on(FastTravelsIpcChannels.response, (event, response) =>
      run(
        Effect.gen(function* () {
          yield* requireGameWindowSender(event.sender);
          const fastTravelResponse = response as Partial<
            FastTravelsResponseMessage & { readonly error?: unknown }
          >;
          if (typeof fastTravelResponse?.requestId !== "string") {
            return;
          }

          if (typeof fastTravelResponse.ok !== "boolean") {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              fastTravelResponse.requestId,
              gameWindow,
              new Error("Invalid fast travel response"),
            );
            return;
          }

          if (fastTravelResponse.ok) {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              fastTravelResponse.requestId,
              gameWindow,
              undefined,
            );
          } else {
            const message =
              typeof fastTravelResponse.error === "string" &&
              fastTravelResponse.error !== ""
                ? fastTravelResponse.error
                : "Fast travel request failed";
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              fastTravelResponse.requestId,
              gameWindow,
              new Error(message),
            );
          }
        }),
      ),
    );

    yield* ipc.handle(FastTravelsIpcChannels.getAll, () =>
      Effect.gen(function* () {
        const repository = yield* FastTravelRepository;
        return yield* repository.get;
      }),
    );

    yield* ipc.handle(FastTravelsIpcChannels.create, (_event, draft) =>
      Effect.gen(function* () {
        const repository = yield* FastTravelRepository;
        return yield* publishLocations(repository, (current) =>
          addFastTravel(
            current,
            normalizeFastTravelDraft(draft as FastTravelDraft),
          ),
        );
      }),
    );

    yield* ipc.handle(
      FastTravelsIpcChannels.update,
      (_event, originalName, draft) =>
        Effect.gen(function* () {
          const repository = yield* FastTravelRepository;
          return yield* publishLocations(repository, (current) =>
            updateFastTravel(
              current,
              typeof originalName === "string" ? originalName : "",
              normalizeFastTravelDraft(draft as FastTravelDraft),
            ),
          );
        }),
    );

    yield* ipc.handle(FastTravelsIpcChannels.delete, (_event, name) =>
      Effect.gen(function* () {
        const repository = yield* FastTravelRepository;
        return yield* publishLocations(repository, (current) =>
          deleteFastTravel(current, typeof name === "string" ? name : ""),
        );
      }),
    );

    yield* ipc.handleContract(FastTravelsIpcContracts.warp, (event, payload) =>
      run(sendFastTravelRequest(event, gameClient, payload)),
    );
  });
