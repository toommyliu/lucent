import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { Effect, Layer } from "effect";

import { ArmyIpc } from "../../shared/ipc";
import { ArmyConfigRepository } from "../internal/army/ArmyConfigRepository";
import {
  ArmyCoordinator,
  type ArmyParticipantId,
  makeArmyCoordinator,
} from "../internal/army/ArmyCoordinator";
import { DesktopIpc } from "./DesktopIpc";

export const coordinatorLayer = Layer.effect(
  ArmyCoordinator,
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;

    const sessionEnded = (
      participantIds: readonly ArmyParticipantId[],
      payload: { readonly reason: string; readonly sessionId: string },
    ) => ipc.sendToBrowserWindowIds(participantIds, ArmyIpc.ended, payload);

    return yield* makeArmyCoordinator({
      sessionEnded,
    });
  }),
);

const senderWindow = (
  event: IpcMainInvokeEvent,
): Effect.Effect<BrowserWindow> =>
  Effect.sync(() => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) throw new Error("Army IPC requires a sender window");
    return window;
  });

export const installArmyIpcHandlers = Effect.gen(function* () {
  const configs = yield* ArmyConfigRepository;
  const coordinator = yield* ArmyCoordinator;
  const ipc = yield* DesktopIpc;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const trackedWindows = new WeakSet<BrowserWindow>();
  const windowListenerCleanups = new Set<() => void>();

  const trackWindow = (window: BrowserWindow): void => {
    if (trackedWindows.has(window)) return;
    trackedWindows.add(window);

    const cleanup = (): void => {
      window.removeListener("closed", handleClosed);
      window.webContents.removeListener("destroyed", handleDestroyed);
      windowListenerCleanups.delete(cleanup);
    };
    const handleClosed = (): void => {
      cleanup();
      runFork(coordinator.abortParticipant(window.id, "Army window closed"));
    };
    const handleDestroyed = (): void => {
      cleanup();
      runFork(coordinator.abortParticipant(window.id, "Army window destroyed"));
    };

    window.once("closed", handleClosed);
    window.webContents.once("destroyed", handleDestroyed);
    windowListenerCleanups.add(cleanup);
  };

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const cleanup of windowListenerCleanups) {
        cleanup();
      }
    }),
  );

  yield* ipc.handle(ArmyIpc.loadConfig, (payload) =>
    configs.read(payload.configName),
  );

  yield* ipc.handle(ArmyIpc.start, (payload, event) =>
    Effect.gen(function* () {
      const [config, sender] = yield* Effect.all([
        configs.read(payload.configName),
        senderWindow(event),
      ]);
      trackWindow(sender);
      return yield* coordinator.join(config, payload.playerName, sender.id);
    }),
  );

  yield* ipc.handle(ArmyIpc.leave, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) =>
        coordinator.leave(payload.sessionId, sender.id),
      ),
    ),
  );

  yield* ipc.handle(ArmyIpc.sync, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) =>
        coordinator.sync(payload.sessionId, sender.id, payload),
      ),
    ),
  );

  yield* ipc.handle(ArmyIpc.progress, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) =>
        coordinator.progress(payload.sessionId, sender.id, payload),
      ),
    ),
  );

  yield* ipc.handle(ArmyIpc.fail, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) =>
        coordinator.fail(payload.sessionId, sender.id, payload.reason),
      ),
    ),
  );
});
