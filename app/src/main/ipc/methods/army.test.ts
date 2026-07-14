import { describe, expect, it } from "@effect/vitest";
import { EventEmitter } from "events";
import { Deferred, Effect } from "effect";

import {
  ArmyCoordinator,
  type ArmyCoordinatorShape,
} from "../../internal/army/ArmyCoordinator";
import type { ElectronWindowHandle } from "../../electron/ElectronWindow";
import {
  DesktopWindows,
  type DesktopWindowCreatedEvent,
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
      type CreatedListener = (
        event: DesktopWindowCreatedEvent,
      ) => Effect.Effect<void, unknown>;
      let onCreated: CreatedListener | undefined;
      const webContents = new EventEmitter();
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
        onCreated: (listener: CreatedListener) =>
          Effect.sync(() => {
            onCreated = listener;
            return () => {
              onCreated = undefined;
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
          expect(onCreated).toBeDefined();
          yield* onCreated!({
            browserWindowId: 42,
            id: "game-test",
            kind: "game",
            window: {
              webContents,
            } as unknown as ElectronWindowHandle,
          });

          webContents.emit("destroyed");

          expect(yield* Deferred.await(aborted)).toEqual({
            browserWindowId: 42,
            reason: "Army window destroyed",
          });
        }),
      );
    }),
  );
});
