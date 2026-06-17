import { Effect, Layer, ServiceMap } from "effect";
import { makeRandomId } from "../../shared/random-id";
import {
  StaleWindowRefError,
  WindowOperationError,
  WindowService,
  type GameWindowRef,
  type WindowManagerError,
} from "./WindowService";

interface PendingRequest {
  readonly gameWindowId: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error | WindowManagerError) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface GameWindowClientRequestOptions<Response> {
  readonly target: GameWindowRef;
  readonly requestChannel: string;
  readonly timeoutMs: number;
  readonly timeoutError: string;
  readonly sendError: string;
  readonly makeMessage: (requestId: string) => unknown;
  readonly onTimeout?: () => Response;
}

export interface GameWindowClientShape {
  readonly request: <Response>(
    options: GameWindowClientRequestOptions<Response>,
  ) => Effect.Effect<Response, Error | WindowManagerError, WindowService>;
  readonly resolve: <Response>(
    requestId: string,
    source: GameWindowRef,
    response: Response | Error,
  ) => Effect.Effect<boolean>;
  readonly rejectAll: (error: Error) => Effect.Effect<void>;
  readonly rejectForGameWindow: (
    source: GameWindowRef,
    error: Error,
  ) => Effect.Effect<void>;
  readonly pendingCount: Effect.Effect<number>;
}

export class GameWindowClient extends ServiceMap.Service<
  GameWindowClient,
  GameWindowClientShape
>()("main/window/GameWindowClient") {}

const toError = (cause: unknown, fallback: string): Error =>
  cause instanceof Error ? cause : new Error(fallback);

export const isPendingResponseOwner = (
  pendingGameWindowId: number,
  source: GameWindowRef,
): boolean => pendingGameWindowId === source.id;

export const makeGameWindowClient = (): GameWindowClientShape => {
  const pendingRequests = new Map<string, PendingRequest>();

  const takePending = (requestId: string): PendingRequest | null => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return null;
    }

    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    return pending;
  };

  const request = <Response>({
    target,
    requestChannel,
    timeoutMs,
    timeoutError,
    sendError,
    makeMessage,
    onTimeout,
  }: GameWindowClientRequestOptions<Response>): Effect.Effect<
    Response,
    Error | WindowManagerError,
    WindowService
  > =>
    Effect.gen(function* () {
      const windows = yield* WindowService;
      return yield* Effect.callback<Response, Error | WindowManagerError>(
        (resume) => {
          const fail = (error: Error | WindowManagerError): void => {
            resume(Effect.fail(error));
          };
          const succeed = (value: unknown): void => {
            resume(Effect.succeed(value as Response));
          };
          const requestId = makeRandomId();
          const timeout = setTimeout(() => {
            const pending = takePending(requestId);
            if (!pending) {
              return;
            }

            if (onTimeout) {
              try {
                pending.resolve(onTimeout());
              } catch (cause) {
                pending.reject(toError(cause, timeoutError));
              }
              return;
            }

            pending.reject(new Error(timeoutError));
          }, timeoutMs);

          pendingRequests.set(requestId, {
            gameWindowId: target.id,
            reject: fail,
            resolve: succeed,
            timeout,
          });

          void Effect.runPromise(
            windows.sendToWindow(
              target,
              requestChannel,
              makeMessage(requestId),
            ),
          ).then(
            (sent) => {
              if (sent) {
                return;
              }

              const pending = takePending(requestId);
              pending?.reject(
                new StaleWindowRefError({
                  ref: target,
                  message: sendError,
                }),
              );
            },
            (cause: unknown) => {
              const pending = takePending(requestId);
              pending?.reject(toError(cause, sendError));
            },
          );

          return Effect.sync(() => {
            takePending(requestId);
          });
        },
      );
    });

  const resolve = <Response>(
    requestId: string,
    source: GameWindowRef,
    response: Response | Error,
  ): Effect.Effect<boolean> =>
    Effect.sync(() => {
      const pending = pendingRequests.get(requestId);
      if (!pending) {
        return false;
      }

      if (!isPendingResponseOwner(pending.gameWindowId, source)) {
        return false;
      }

      takePending(requestId);
      if (response instanceof Error) {
        pending.reject(response);
      } else {
        pending.resolve(response);
      }

      return true;
    });

  const rejectAllSync = (
    error: Error,
    options?: { readonly gameWindowId?: number },
  ): void => {
    for (const [requestId, pending] of pendingRequests) {
      if (
        options?.gameWindowId !== undefined &&
        pending.gameWindowId !== options.gameWindowId
      ) {
        continue;
      }

      takePending(requestId)?.reject(error);
    }
  };

  return {
    pendingCount: Effect.sync(() => pendingRequests.size),
    rejectAll: (error) =>
      Effect.sync(() => {
        rejectAllSync(error);
      }),
    rejectForGameWindow: (source, error) =>
      Effect.sync(() => {
        rejectAllSync(error, { gameWindowId: source.id });
      }),
    request,
    resolve,
  };
};

export const layer = Layer.effect(GameWindowClient)(
  Effect.gen(function* () {
    const client = makeGameWindowClient();
    yield* Effect.addFinalizer(() =>
      client.rejectAll(
        new WindowOperationError({
          message: "Game client scope closed",
        }),
      ),
    );
    return client;
  }),
);
