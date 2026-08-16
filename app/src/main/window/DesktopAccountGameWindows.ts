import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { AccountLaunchWindowTarget } from "@lucent/core/accounts";
import {
  AccountGameWindows,
  type AccountGameWindowEvent,
} from "../internal/accounts/AccountGameWindows";
import { DesktopWindows, type DesktopGameHostTarget } from "./DesktopWindows";

const resolveGameHostTarget = (
  target: AccountLaunchWindowTarget | undefined,
): DesktopGameHostTarget => {
  if (target === undefined) return { kind: "available" };
  return target.kind === "new"
    ? { kind: "new" }
    : { rendererId: target.gameWindowId, kind: "game-view" };
};

export const layer = Layer.effect(
  AccountGameWindows,
  Effect.gen(function* () {
    const windows = yield* DesktopWindows;

    const toAccountGameWindowEvent = Effect.fn(
      "DesktopAccountGameWindows.toAccountGameWindowEvent",
    )(function* (event: {
      readonly generation: number;
      readonly rendererId: number;
    }): Effect.fn.Return<AccountGameWindowEvent> {
      const gameWindowGroupId = yield* windows
        .getNativeWindowId(event.rendererId)
        .pipe(
          Effect.match({
            onFailure: (): undefined => undefined,
            onSuccess: (groupId): number => groupId,
          }),
        );
      return {
        ...(gameWindowGroupId === undefined ? {} : { gameWindowGroupId }),
        gameWindowId: event.rendererId,
        rendererGeneration: event.generation,
      };
    });

    const close: AccountGameWindows["Service"]["close"] = (gameWindowId) =>
      windows.closeRenderer(gameWindowId);

    const getGeneration: AccountGameWindows["Service"]["getGeneration"] = (
      gameWindowId,
    ) => windows.getRendererGeneration(gameWindowId);

    const getGroupId: AccountGameWindows["Service"]["getGroupId"] = (
      gameWindowId,
    ) => windows.getNativeWindowId(gameWindowId);

    const onClosed: AccountGameWindows["Service"]["onClosed"] = (listener) =>
      windows.onClosed((event) =>
        event.kind === "game" ? listener(event.rendererId) : Effect.void,
      );

    const onCreated: AccountGameWindows["Service"]["onCreated"] = (listener) =>
      windows.onCreated((event) =>
        event.kind === "game"
          ? toAccountGameWindowEvent(event).pipe(Effect.flatMap(listener))
          : Effect.void,
      );

    const onReloaded: AccountGameWindows["Service"]["onReloaded"] = (
      listener,
    ) =>
      windows.onRendererReloaded((event) =>
        event.kind === "game"
          ? toAccountGameWindowEvent(event).pipe(Effect.flatMap(listener))
          : Effect.void,
      );

    const open: AccountGameWindows["Service"]["open"] = (options) =>
      Effect.gen(function* () {
        let gameWindowId: number | undefined;
        const onCreated = options?.onCreated;
        const instanceId = yield* windows.open("game", {
          gameHostTarget: resolveGameHostTarget(options?.windowTarget),
          ...(options?.managedProfileKey === undefined
            ? {}
            : { managedGameProfileKey: options.managedProfileKey }),
          ...(options?.name === undefined
            ? {}
            : { gameViewName: options.name }),
          ...(options?.tile === undefined ? {} : { tile: options.tile }),
          ...(onCreated === undefined
            ? {}
            : {
                onCreated: (event) =>
                  toAccountGameWindowEvent(event).pipe(
                    Effect.tap((accountEvent) =>
                      Effect.sync(() => {
                        gameWindowId = accountEvent.gameWindowId;
                      }),
                    ),
                    Effect.flatMap(onCreated),
                  ),
              }),
        });
        return gameWindowId ?? (yield* windows.getRendererId(instanceId));
      });

    const reveal: AccountGameWindows["Service"]["reveal"] = (gameWindowId) =>
      windows.revealRenderer(gameWindowId);

    const retireProfile: AccountGameWindows["Service"]["retireProfile"] =
      windows.retireManagedGameProfile;

    const setName: AccountGameWindows["Service"]["setName"] = (
      gameWindowId,
      name,
    ) => windows.setGameViewName(gameWindowId, name);

    return AccountGameWindows.of({
      close,
      getGeneration,
      getGroupId,
      onClosed,
      onCreated,
      onReloaded,
      open,
      reveal,
      retireProfile,
      setName,
    });
  }),
);
