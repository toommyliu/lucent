import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
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
  broker: GameWindowRequestBroker<GrabbedData | null>,
  gameWindow: BrowserWindow,
  kind: LoaderGrabberRequestKind,
  payload: LoaderGrabberLoadRequest | LoaderGrabberGrabRequest,
): Promise<GrabbedData | null> =>
  broker.request({
    target: gameWindow,
    requestChannel: LoaderGrabberIpcChannels.request,
    timeoutMs: LOADER_GRABBER_REQUEST_TIMEOUT_MS,
    timeoutError: "Loader grabber did not respond",
    sendError: "Loader grabber request failed",
    makeMessage: (requestId) => makeRequestMessage(requestId, kind, payload),
  });

const sendLoaderGrabberRequest = (
  event: IpcMainInvokeEvent,
  broker: GameWindowRequestBroker<GrabbedData | null>,
  kind: LoaderGrabberRequestKind,
  payload: LoaderGrabberLoadRequest | LoaderGrabberGrabRequest,
): Effect.Effect<GrabbedData | null, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindow } = yield* getSenderGameWindow(event.sender);

    return yield* Effect.tryPromise({
      try: () => requestGameLoaderGrabber(broker, gameWindow, kind, payload),
      catch: (cause) =>
        new WindowManagerError({
          message: requestErrorMessage(cause),
          cause,
        }),
    });
  });

export const registerLoaderGrabberIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<void, never, MainIpc | Scope.Scope> =>
  Effect.gen(function* () {
    const ipc = yield* MainIpc;
    const broker = makeGameWindowRequestBroker<GrabbedData | null>();
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
            broker.resolve(
              loaderGrabberResponse.requestId,
              new Error("Invalid loader grabber response"),
            );
            return;
          }

          if (loaderGrabberResponse.ok) {
            broker.resolve(
              loaderGrabberResponse.requestId,
              loaderGrabberResponse.value ?? null,
            );
            return;
          }

          const message =
            typeof loaderGrabberResponse.error === "string" &&
            loaderGrabberResponse.error !== ""
              ? loaderGrabberResponse.error
              : "Loader grabber request failed";
          broker.resolve(loaderGrabberResponse.requestId, new Error(message));
        }),
      ),
    );

    yield* ipc.handleContract(
      LoaderGrabberIpcContracts.load,
      (event, payload) =>
        Effect.asVoid(
          run(sendLoaderGrabberRequest(event, broker, "load", payload)),
        ),
    );

    yield* ipc.handleContract(
      LoaderGrabberIpcContracts.grab,
      (event, payload) =>
        run(sendLoaderGrabberRequest(event, broker, "grab", payload)),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        broker.rejectAll(new Error("Loader grabber IPC is shutting down"));
      }),
    );
  });
