import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  LoaderGrabberIpc,
  type LoaderGrabberOutcome,
  type LoaderGrabberRequest,
  type LoaderGrabberResponse,
} from "../../../shared/ipc/loaderGrabber";
import type {
  LoaderGrabberGrabRequest,
  LoaderGrabberLoadRequest,
} from "../../../shared/loader-grabber";
import { createRandomId } from "../../../shared/randomId";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";

export const LOADER_GRABBER_REQUEST_TIMEOUT_MS = 12_000;

export type LoaderGrabberRequestInput =
  | {
      readonly kind: "grab";
      readonly payload: LoaderGrabberGrabRequest;
    }
  | {
      readonly kind: "load";
      readonly payload: LoaderGrabberLoadRequest;
    };

export class LoaderGrabberRequestError extends Schema.TaggedErrorClass<LoaderGrabberRequestError>()(
  "LoaderGrabberRequestError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

interface PendingRequest {
  readonly gameRendererId: number;
  readonly gate: Deferred.Deferred<
    LoaderGrabberOutcome,
    LoaderGrabberRequestError
  >;
  readonly kind: LoaderGrabberRequestInput["kind"];
}

export interface GameLoaderGrabbersShape {
  readonly remove: (gameRendererId: number) => Effect.Effect<void>;
  readonly request: (
    gameRendererId: number,
    input: LoaderGrabberRequestInput,
  ) => Effect.Effect<LoaderGrabberOutcome, LoaderGrabberRequestError>;
  readonly respond: (
    gameRendererId: number,
    response: LoaderGrabberResponse,
  ) => Effect.Effect<void>;
}

export class GameLoaderGrabbers extends Context.Service<
  GameLoaderGrabbers,
  GameLoaderGrabbersShape
>()("lucent/internal/loader-grabber/GameLoaderGrabbers") {}

export const makeGameLoaderGrabbers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc;
  const windows = yield* DesktopWindows;
  const pendingRequests = new Map<string, PendingRequest>();

  const remove: GameLoaderGrabbersShape["remove"] = Effect.fn(
    "GameLoaderGrabbers.remove",
  )(function* (gameRendererId) {
    for (const [requestId, pending] of pendingRequests) {
      if (pending.gameRendererId !== gameRendererId) {
        continue;
      }
      pendingRequests.delete(requestId);
      yield* Deferred.fail(
        pending.gate,
        new LoaderGrabberRequestError({
          detail: "The game renderer is unavailable.",
        }),
      );
    }
  });

  const request: GameLoaderGrabbersShape["request"] = Effect.fn(
    "GameLoaderGrabbers.request",
  )(function* (gameRendererId, input) {
    const rendererReady = yield* windows
      .isRendererReady(gameRendererId)
      .pipe(Effect.catch(() => Effect.succeed(false)));
    if (!rendererReady) {
      return yield* new LoaderGrabberRequestError({
        detail: "The game renderer is reloading.",
      });
    }

    const requestId = createRandomId("loader-grabber");
    const gate = yield* Deferred.make<
      LoaderGrabberOutcome,
      LoaderGrabberRequestError
    >();
    pendingRequests.set(requestId, {
      gameRendererId,
      gate,
      kind: input.kind,
    });

    const message = {
      ...input,
      requestId,
    } as LoaderGrabberRequest;
    yield* ipc.sendToRendererIds(
      [gameRendererId],
      LoaderGrabberIpc.request,
      message,
    );

    const result = yield* Deferred.await(gate).pipe(
      Effect.timeoutOption(LOADER_GRABBER_REQUEST_TIMEOUT_MS),
      Effect.ensuring(
        Effect.sync(() => {
          pendingRequests.delete(requestId);
        }),
      ),
    );
    if (Option.isNone(result)) {
      return yield* new LoaderGrabberRequestError({
        detail: "The game did not respond to the Loader grabber request.",
      });
    }
    return result.value;
  });

  const respond: GameLoaderGrabbersShape["respond"] = Effect.fn(
    "GameLoaderGrabbers.respond",
  )(function* (gameRendererId, response) {
    const pending = pendingRequests.get(response.requestId);
    if (pending === undefined || pending.gameRendererId !== gameRendererId) {
      return;
    }

    pendingRequests.delete(response.requestId);
    if (!response.ok) {
      yield* Deferred.fail(
        pending.gate,
        new LoaderGrabberRequestError({
          detail: response.error || "The Loader grabber request failed.",
        }),
      );
      return;
    }
    if (response.outcome.kind !== pending.kind) {
      yield* Deferred.fail(
        pending.gate,
        new LoaderGrabberRequestError({
          detail: `The game returned ${response.outcome.kind} for a ${pending.kind} request.`,
        }),
      );
      return;
    }
    yield* Deferred.succeed(pending.gate, response.outcome);
  });

  const removeGame = (event: { readonly rendererId: number }) =>
    remove(event.rendererId);
  const unsubscribeClosed = yield* windows.onClosed((event) =>
    event.kind === "game" ? removeGame(event) : Effect.void,
  );
  const unsubscribeDestroyed = yield* windows.onRendererDestroyed((event) =>
    event.kind === "game" ? removeGame(event) : Effect.void,
  );
  const unsubscribeUnavailable = yield* windows.onRendererUnavailable((event) =>
    event.kind === "game" ? removeGame(event) : Effect.void,
  );
  const unsubscribeReloaded = yield* windows.onRendererReloaded((event) =>
    event.kind === "game" ? removeGame(event) : Effect.void,
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeClosed();
      unsubscribeDestroyed();
      unsubscribeUnavailable();
      unsubscribeReloaded();
    }),
  );

  return GameLoaderGrabbers.of({ remove, request, respond });
});

export const layer = Layer.effect(GameLoaderGrabbers, makeGameLoaderGrabbers);
