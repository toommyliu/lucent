import { addEnvironmentItem } from "@lucent/core/environment";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { DesktopIpc } from "../../ipc/DesktopIpc";
import {
  DesktopWindows,
  type DesktopWindowRendererUnavailableEvent,
} from "../../window/DesktopWindows";
import { makeGameEnvironments } from "./GameEnvironments";

describe("GameEnvironments", () => {
  it.effect(
    "preserves state and settles transient work when the game reloads or becomes unavailable",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let reload: (() => Effect.Effect<void, unknown>) | undefined;
          let unavailable: (() => Effect.Effect<void, unknown>) | undefined;
          const ipc = DesktopIpc.of({
            handle: () => Effect.void,
            sendToAll: () => Effect.void,
            sendToRendererIds: () => Effect.void,
          });
          const windows = {
            isRendererReady: () => Effect.succeed(true),
            onClosed: () => Effect.succeed(() => undefined),
            onRendererDestroyed: () => Effect.succeed(() => undefined),
            onRendererUnavailable: (
              listener: (
                event: DesktopWindowRendererUnavailableEvent,
              ) => Effect.Effect<void, unknown>,
            ) =>
              Effect.sync(() => {
                unavailable = () =>
                  listener({
                    failure: {
                      name: "Shockwave Flash",
                      type: "plugin-crashed",
                      version: "32.0.0.344",
                    },
                    rendererId: 42,
                    id: "game-42",
                    kind: "game",
                  });
                return () => {
                  unavailable = undefined;
                };
              }),
            onRendererReloaded: (
              listener: (event: {
                readonly rendererId: number;
                readonly generation: number;
                readonly id: string;
                readonly kind: "game";
              }) => Effect.Effect<void, unknown>,
            ) =>
              Effect.sync(() => {
                reload = () =>
                  listener({
                    rendererId: 42,
                    generation: 2,
                    id: "game-42",
                    kind: "game",
                  });
                return () => {
                  reload = undefined;
                };
              }),
          } as unknown as DesktopWindows["Service"];
          const environments = yield* makeGameEnvironments.pipe(
            Effect.provideService(DesktopIpc, ipc),
            Effect.provideService(DesktopWindows, windows),
          );

          yield* environments.update(42, (state) =>
            addEnvironmentItem(state, "Potion"),
          );
          const pending = yield* Effect.forkScoped(
            environments.fetchBoosts(42),
          );
          yield* Effect.yieldNow;
          yield* reload!();

          expect(yield* Fiber.join(pending)).toEqual({
            bank: [],
            bankLoaded: false,
            inventory: [],
          });

          const unavailablePending = yield* Effect.forkScoped(
            environments.fetchBoosts(42),
          );
          yield* Effect.yieldNow;
          yield* unavailable!();
          expect(yield* Fiber.join(unavailablePending)).toEqual({
            bank: [],
            bankLoaded: false,
            inventory: [],
          });
          expect((yield* environments.get(42)).itemNames).toEqual(["Potion"]);
        }),
      ),
  );
});
