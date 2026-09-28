import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PacketsIpc } from "../../../shared/ipc/packets";
import type { PacketsStatusPayload } from "../../../shared/packets";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";

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
}

export class GamePackets extends Context.Service<
  GamePackets,
  GamePacketsShape
>()("lucent/internal/packets/GamePackets") {}

export const makeGamePackets = Effect.gen(function* () {
  const ipc = yield* DesktopIpc;
  const windows = yield* DesktopWindows;
  const statuses = new Map<number, PacketsStatusPayload>();

  const getStatus: GamePacketsShape["getStatus"] = (gameRendererId) =>
    windows.isRendererReady(gameRendererId).pipe(
      Effect.map((rendererReady) =>
        rendererReady
          ? (statuses.get(gameRendererId) ?? stoppedStatus())
          : stoppedStatus(),
      ),
      Effect.orElseSucceed(() =>
        stoppedStatus("The game renderer is unavailable"),
      ),
    );

  const publishStatus: GamePacketsShape["publishStatus"] = Effect.fn(
    "GamePackets.publishStatus",
  )(function* (gameRendererId, status) {
    const next = { ...status };
    statuses.set(gameRendererId, next);
    const targets = yield* windows
      .getOwnedRendererIds(gameRendererId, "packets")
      .pipe(Effect.orElseSucceed(() => []));
    yield* ipc.sendToRendererIds(targets, PacketsIpc.status, next);
  });

  const stopGame = (
    event: { readonly kind: string; readonly rendererId: number },
    stoppedReason?: string,
  ) =>
    event.kind === "game"
      ? publishStatus(event.rendererId, stoppedStatus(stoppedReason))
      : Effect.void;
  const unavailableReason =
    "Packet activity stopped because the game renderer is unavailable";
  const unsubscribers = yield* Effect.all([
    windows.onClosed((event) =>
      event.kind === "game"
        ? Effect.sync(() => statuses.delete(event.rendererId))
        : Effect.void,
    ),
    windows.onRendererDestroyed((event) => stopGame(event, unavailableReason)),
    windows.onRendererUnavailable((event) =>
      stopGame(event, unavailableReason),
    ),
    windows.onRendererReloaded((event) => stopGame(event)),
  ]);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    }),
  );

  return GamePackets.of({ getStatus, publishStatus });
});

export const layer = Layer.effect(GamePackets, makeGamePackets);
