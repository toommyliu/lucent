import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  PacketsIpc,
  type PacketsOutcome,
  type PacketsRequest,
  type PacketsResponse,
} from "../../../shared/ipc/packets";
import type {
  PacketQueuePayload,
  PacketSendPayload,
  PacketsStatusPayload,
} from "../../../shared/packets";
import { createRandomId } from "../../../shared/randomId";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";

export const PACKETS_REQUEST_TIMEOUT_MS = 5_000;

export type PacketsRequestInput =
  | { readonly kind: "start-capture" }
  | { readonly kind: "stop-capture" }
  | { readonly kind: "send"; readonly payload: PacketSendPayload }
  | { readonly kind: "start-queue"; readonly payload: PacketQueuePayload }
  | { readonly kind: "stop-queue" };

export class PacketsRequestError extends Schema.TaggedError<PacketsRequestError>()(
  "PacketsRequestError",
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
  readonly gate: Deferred.Deferred<PacketsOutcome, PacketsRequestError>;
  readonly kind: PacketsRequestInput["kind"];
}

const stoppedStatus = (stoppedReason?: string): PacketsStatusPayload => ({
  captureRunning: false,
  queueRunning: false,
  ...(stoppedReason === undefined ? {} : { stoppedReason }),
});

export interface GamePacketsShape {
  readonly getStatus: (
    gameRendererId: number,
  ) => Effect.Effect<PacketsStatusPayload>;
  readonly publishStatus: (
    gameRendererId: number,
    status: PacketsStatusPayload,
  ) => Effect.Effect<void>;
  readonly remove: (gameRendererId: number) => Effect.Effect<void>;
  readonly request: (
    gameRendererId: number,
    input: PacketsRequestInput,
  ) => Effect.Effect<PacketsOutcome, PacketsRequestError>;
  readonly respond: (
    gameRendererId: number,
    response: PacketsResponse,
  ) => Effect.Effect<void>;
}

export class GamePackets extends Context.Service<
  GamePackets,
  GamePacketsShape
>()("lucent/internal/packets/GamePackets") {}

export const makeGamePackets = Effect.gen(function* () {
  const ipc = yield* DesktopIpc;
  const windows = yield* DesktopWindows;
  const pendingRequests = new Map<string, PendingRequest>();
  const statuses = new Map<number, PacketsStatusPayload>();

  const getStatus: GamePacketsShape["getStatus"] = (gameRendererId) =>
    windows.isRendererReady(gameRendererId).pipe(
      Effect.map((rendererReady) =>
        rendererReady
          ? (statuses.get(gameRendererId) ?? stoppedStatus())
          : stoppedStatus(),
      ),
      Effect.catch(() =>
        Effect.succeed(stoppedStatus("The game renderer is unavailable")),
      ),
    );

  const publishStatus: GamePacketsShape["publishStatus"] = Effect.fn(
    "GamePackets.publishStatus",
  )(function* (gameRendererId, status) {
    const next = { ...status };
    statuses.set(gameRendererId, next);
    const targets = yield* windows
      .getOwnedRendererIds(gameRendererId, "packets")
      .pipe(Effect.catch(() => Effect.succeed([])));
    yield* ipc.sendToRendererIds(targets, PacketsIpc.status, next);
  });

  const remove: GamePacketsShape["remove"] = Effect.fn("GamePackets.remove")(
    function* (gameRendererId) {
      for (const [requestId, pending] of pendingRequests) {
        if (pending.gameRendererId !== gameRendererId) {
          continue;
        }

        pendingRequests.delete(requestId);
        yield* Deferred.fail(
          pending.gate,
          new PacketsRequestError({
            detail: "The game renderer is unavailable.",
          }),
        );
      }
    },
  );

  const request: GamePacketsShape["request"] = Effect.fn("GamePackets.request")(
    function* (gameRendererId, input) {
      const rendererReady = yield* windows
        .isRendererReady(gameRendererId)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!rendererReady) {
        return yield* new PacketsRequestError({
          detail: "The game renderer is reloading.",
        });
      }

      const requestId = createRandomId("packets");
      const gate = yield* Deferred.make<PacketsOutcome, PacketsRequestError>();
      pendingRequests.set(requestId, {
        gameRendererId,
        gate,
        kind: input.kind,
      });

      yield* ipc.sendToRendererIds([gameRendererId], PacketsIpc.request, {
        ...input,
        requestId,
      } as PacketsRequest);

      const result = yield* Deferred.await(gate).pipe(
        Effect.timeoutOption(PACKETS_REQUEST_TIMEOUT_MS),
        Effect.ensuring(
          Effect.sync(() => {
            pendingRequests.delete(requestId);
          }),
        ),
      );
      if (Option.isNone(result)) {
        return yield* new PacketsRequestError({
          detail: "The game did not respond to the Packets request.",
        });
      }
      return result.value;
    },
  );

  const respond: GamePacketsShape["respond"] = Effect.fn("GamePackets.respond")(
    function* (gameRendererId, response) {
      const pending = pendingRequests.get(response.requestId);
      if (pending === undefined || pending.gameRendererId !== gameRendererId) {
        return;
      }

      pendingRequests.delete(response.requestId);
      if (!response.ok) {
        yield* Deferred.fail(
          pending.gate,
          new PacketsRequestError({
            detail: response.error || "The Packets request failed.",
          }),
        );
        return;
      }
      if (response.outcome.kind !== pending.kind) {
        yield* Deferred.fail(
          pending.gate,
          new PacketsRequestError({
            detail: `The game returned ${response.outcome.kind} for a ${pending.kind} request.`,
          }),
        );
        return;
      }
      yield* Deferred.succeed(pending.gate, response.outcome);
    },
  );

  const removeGame = (event: { readonly rendererId: number }) =>
    remove(event.rendererId);
  const invalidateGame = (
    event: { readonly rendererId: number },
    stoppedReason?: string,
  ) =>
    Effect.all([
      removeGame(event),
      publishStatus(event.rendererId, stoppedStatus(stoppedReason)),
    ]).pipe(Effect.asVoid);
  const unsubscribeClosed = yield* windows.onClosed((event) =>
    event.kind === "game"
      ? removeGame(event).pipe(
          Effect.andThen(Effect.sync(() => statuses.delete(event.rendererId))),
        )
      : Effect.void,
  );
  const unsubscribeDestroyed = yield* windows.onRendererDestroyed((event) =>
    event.kind === "game"
      ? invalidateGame(
          event,
          "Packet activity stopped because the game renderer is unavailable",
        )
      : Effect.void,
  );
  const unsubscribeUnavailable = yield* windows.onRendererUnavailable((event) =>
    event.kind === "game"
      ? invalidateGame(
          event,
          event.failure.type === "plugin-crashed"
            ? "Packet activity stopped because the Flash plugin crashed"
            : "Packet activity stopped because the game renderer is unavailable",
        )
      : Effect.void,
  );
  const unsubscribeReloaded = yield* windows.onRendererReloaded((event) =>
    event.kind === "game" ? invalidateGame(event) : Effect.void,
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeClosed();
      unsubscribeDestroyed();
      unsubscribeUnavailable();
      unsubscribeReloaded();
    }),
  );

  return GamePackets.of({ getStatus, publishStatus, remove, request, respond });
});

export const layer = Layer.effect(GamePackets, makeGamePackets);
