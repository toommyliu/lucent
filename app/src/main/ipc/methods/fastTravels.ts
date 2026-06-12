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
} from "../../persistence/fastTravels/FastTravelRepository";
import {
  WindowManagerError,
  type WindowEffectRunner,
  type WindowService,
} from "../../window/WindowService";
import {
  makeGameWindowRequestBroker,
  type GameWindowRequestBroker,
} from "../GameWindowRequestBroker";
import { MainIpc } from "../MainIpc";
import {
  getSenderGameWindow,
  requireGameWindowSender,
} from "../SenderAuthorization";

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
    } catch {
      // Window teardown can race the destroyed checks; broadcasts are best effort.
    }
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
  broker: GameWindowRequestBroker<void>,
  gameWindow: BrowserWindow,
  payload: FastTravelWarpPayload,
): Promise<void> =>
  broker.request({
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
  broker: GameWindowRequestBroker<void>,
  payload: FastTravelWarpPayload,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindow } = yield* getSenderGameWindow(event.sender);

    return yield* Effect.tryPromise({
      try: () => requestGameFastTravel(broker, gameWindow, payload),
      catch: (cause) =>
        new WindowManagerError({
          message: requestErrorMessage(cause),
          cause,
        }),
    });
  });

export const registerFastTravelsIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<void, never, FastTravelRepository | MainIpc | Scope.Scope> =>
  Effect.gen(function* () {
    const ipc = yield* MainIpc;
    const broker = makeGameWindowRequestBroker<void>();
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
            broker.resolve(
              fastTravelResponse.requestId,
              new Error("Invalid fast travel response"),
            );
            return;
          }

          if (fastTravelResponse.ok) {
            broker.resolve(fastTravelResponse.requestId, undefined);
          } else {
            const message =
              typeof fastTravelResponse.error === "string" &&
              fastTravelResponse.error !== ""
                ? fastTravelResponse.error
                : "Fast travel request failed";
            broker.resolve(fastTravelResponse.requestId, new Error(message));
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
      run(sendFastTravelRequest(event, broker, payload)),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        broker.rejectAll(new Error("Fast travels IPC scope closed"));
      }),
    );
  });
