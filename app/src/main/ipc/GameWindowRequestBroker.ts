import type { BrowserWindow } from "electron";
import { makeRandomId } from "../../shared/random-id";

interface PendingRequest<Response> {
  readonly resolve: (value: Response) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface GameWindowRequestOptions<Response> {
  readonly target: BrowserWindow;
  readonly requestChannel: string;
  readonly timeoutMs: number;
  readonly timeoutError: string;
  readonly sendError: string;
  readonly makeMessage: (requestId: string) => unknown;
  readonly onTimeout?: () => Response;
}

export interface GameWindowRequestBroker<Response> {
  readonly request: (
    options: GameWindowRequestOptions<Response>,
  ) => Promise<Response>;
  readonly resolve: (requestId: string, response: Response | Error) => boolean;
  readonly rejectAll: (error: Error) => void;
  readonly pendingCount: () => number;
}

const toError = (cause: unknown, fallback: string): Error =>
  cause instanceof Error ? cause : new Error(fallback);

export const makeGameWindowRequestBroker = <
  Response,
>(): GameWindowRequestBroker<Response> => {
  const pendingRequests = new Map<string, PendingRequest<Response>>();

  const takePending = (requestId: string): PendingRequest<Response> | null => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return null;
    }

    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    return pending;
  };

  const request = ({
    target,
    requestChannel,
    timeoutMs,
    timeoutError,
    sendError,
    makeMessage,
    onTimeout,
  }: GameWindowRequestOptions<Response>): Promise<Response> =>
    new Promise((resolve, reject) => {
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

      pendingRequests.set(requestId, { resolve, reject, timeout });

      try {
        if (target.isDestroyed() || target.webContents.isDestroyed()) {
          throw new Error(sendError);
        }

        target.webContents.send(requestChannel, makeMessage(requestId));
      } catch (cause) {
        const pending = takePending(requestId);
        if (!pending) {
          return;
        }

        pending.reject(toError(cause, sendError));
      }
    });

  const resolve = (requestId: string, response: Response | Error): boolean => {
    const pending = takePending(requestId);
    if (!pending) {
      return false;
    }

    if (response instanceof Error) {
      pending.reject(response);
    } else {
      pending.resolve(response);
    }

    return true;
  };

  const rejectAll = (error: Error): void => {
    for (const requestId of pendingRequests.keys()) {
      const pending = takePending(requestId);
      pending?.reject(error);
    }
  };

  return {
    request,
    resolve,
    rejectAll,
    pendingCount: () => pendingRequests.size,
  };
};
