import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { AccountLaunchWindowTarget } from "@lucent/core/accounts";
import { AccountGameWindows } from "../internal/accounts/AccountGameWindows";
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

    const close: AccountGameWindows["Service"]["close"] = (gameWindowId) =>
      windows.closeRenderer(gameWindowId);

    const getGroupId: AccountGameWindows["Service"]["getGroupId"] = (
      gameWindowId,
    ) => windows.getNativeWindowId(gameWindowId);

    const getRendererGeneration: AccountGameWindows["Service"]["getRendererGeneration"] =
      (gameWindowId) => windows.getRendererGeneration(gameWindowId);

    const onCreated: AccountGameWindows["Service"]["onCreated"] = (listener) =>
      windows.onCreated((event) =>
        event.kind === "game"
          ? listener(event.rendererId, event.generation)
          : Effect.void,
      );

    const onClosed: AccountGameWindows["Service"]["onClosed"] = (listener) =>
      windows.onClosed((event) =>
        event.kind === "game" ? listener(event.rendererId) : Effect.void,
      );

    const onRendererReloaded: AccountGameWindows["Service"]["onRendererReloaded"] =
      (listener) =>
        windows.onRendererReloaded((event) =>
          event.kind === "game"
            ? listener(event.rendererId, event.generation)
            : Effect.void,
        );

    const open: AccountGameWindows["Service"]["open"] = (options) =>
      Effect.gen(function* () {
        let gameWindowId: number | undefined;
        const instanceId = yield* windows.open("game", {
          gameHostTarget: resolveGameHostTarget(options?.windowTarget),
          ...(options?.managedProfileKey === undefined
            ? {}
            : { managedGameProfileKey: options.managedProfileKey }),
          ...(options?.name === undefined
            ? {}
            : { gameViewName: options.name }),
          ...(options?.tile === undefined ? {} : { tile: options.tile }),
          ...(options?.onCreated === undefined
            ? {}
            : {
                onCreated: ({ rendererId }) => {
                  gameWindowId = rendererId;
                  return options.onCreated!(rendererId);
                },
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
      getGroupId,
      getRendererGeneration,
      onCreated,
      onClosed,
      onRendererReloaded,
      open,
      reveal,
      retireProfile,
      setName,
    });
  }),
);
