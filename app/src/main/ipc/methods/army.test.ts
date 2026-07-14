import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";

import {
  ArmyCoordinator,
  type ArmyCoordinatorShape,
} from "../../internal/army/ArmyCoordinator";
import {
  DesktopWindows,
  type DesktopWindowRendererDestroyedEvent,
  type DesktopWindowsShape,
} from "../../window/DesktopWindows";
import { DesktopIpc, type DesktopIpcShape } from "../DesktopIpc";
import { installLifecycle } from "./army";

describe("Army IPC lifecycle", () => {
  it.effect("aborts a participant when game web contents are destroyed", () =>
    Effect.gen(function* () {
      const aborted = yield* Deferred.make<{
        readonly browserWindowId: number;
        readonly reason: string;
      }>();
      type RendererDestroyedListener = (
        event: DesktopWindowRendererDestroyedEvent,
      ) => Effect.Effect<void, unknown>;
      let onRendererDestroyed: RendererDestroyedListener | undefined;
      const coordinator = ArmyCoordinator.of({
        abortParticipant: (browserWindowId: number, reason: string) =>
          Deferred.succeed(aborted, { browserWindowId, reason }).pipe(
            Effect.asVoid,
          ),
        onSessionEnded: () => Effect.succeed(() => undefined),
      } as unknown as ArmyCoordinatorShape);
      const ipc = DesktopIpc.of({
        sendToBrowserWindowIds: () => Effect.void,
      } as unknown as DesktopIpcShape);
      const windows = DesktopWindows.of({
        onClosed: () => Effect.succeed(() => undefined),
        onRendererDestroyed: (listener: RendererDestroyedListener) =>
          Effect.sync(() => {
            onRendererDestroyed = listener;
            return () => {
              onRendererDestroyed = undefined;
            };
          }),
      } as unknown as DesktopWindowsShape);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* installLifecycle().pipe(
            Effect.provideService(ArmyCoordinator, coordinator),
            Effect.provideService(DesktopIpc, ipc),
            Effect.provideService(DesktopWindows, windows),
          );
          expect(onRendererDestroyed).toBeDefined();
          yield* onRendererDestroyed!({
            browserWindowId: 42,
            id: "game-test",
            kind: "game",
          });

          expect(yield* Deferred.await(aborted)).toEqual({
            browserWindowId: 42,
            reason: "Army window destroyed",
          });
        }),
      );
    }),
  );
});
