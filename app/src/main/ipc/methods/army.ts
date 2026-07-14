import { Effect } from "effect";

import { ArmyIpc } from "../../../shared/ipc";
import { ArmyConfigRepository } from "../../internal/army/ArmyConfigRepository";
import { ArmyCoordinator } from "../../internal/army/ArmyCoordinator";
import { DesktopWindows } from "../../window/DesktopWindows";
import { DesktopIpc, makeDesktopIpcMethod } from "../DesktopIpc";

const gameSenders = ["game"] as const;

export const loadConfig = makeDesktopIpcMethod({
  descriptor: ArmyIpc.loadConfig,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.army.loadConfig")(function* (payload) {
    const configs = yield* ArmyConfigRepository;
    return yield* configs.read(payload.configName);
  }),
});

export const start = makeDesktopIpcMethod({
  descriptor: ArmyIpc.start,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.army.start")(function* (payload, sender) {
    const configs = yield* ArmyConfigRepository;
    const coordinator = yield* ArmyCoordinator;
    const config = yield* configs.read(payload.configName);
    return yield* coordinator.join(
      config,
      payload.playerName,
      sender.browserWindowId,
    );
  }),
});

export const leave = makeDesktopIpcMethod({
  descriptor: ArmyIpc.leave,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.army.leave")(function* (payload, sender) {
    const coordinator = yield* ArmyCoordinator;
    return yield* coordinator.leave(payload.sessionId, sender.browserWindowId);
  }),
});

export const sync = makeDesktopIpcMethod({
  descriptor: ArmyIpc.sync,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.army.sync")(function* (payload, sender) {
    const coordinator = yield* ArmyCoordinator;
    return yield* coordinator.sync(
      payload.sessionId,
      sender.browserWindowId,
      payload,
    );
  }),
});

export const progress = makeDesktopIpcMethod({
  descriptor: ArmyIpc.progress,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.army.progress")(function* (payload, sender) {
    const coordinator = yield* ArmyCoordinator;
    return yield* coordinator.progress(
      payload.sessionId,
      sender.browserWindowId,
      payload,
    );
  }),
});

export const fail = makeDesktopIpcMethod({
  descriptor: ArmyIpc.fail,
  allowedSenders: gameSenders,
  handler: Effect.fn("desktop.ipc.army.fail")(function* (payload, sender) {
    const coordinator = yield* ArmyCoordinator;
    return yield* coordinator.fail(
      payload.sessionId,
      sender.browserWindowId,
      payload.reason,
    );
  }),
});

export const methods = [
  loadConfig,
  start,
  leave,
  sync,
  progress,
  fail,
] as const;

export const installLifecycle = Effect.fn("desktop.ipc.army.installLifecycle")(
  function* () {
    const coordinator = yield* ArmyCoordinator;
    const ipc = yield* DesktopIpc;
    const windows = yield* DesktopWindows;
    const context = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(context);
    const destroyedListenerCleanups = new Map<number, () => void>();

    const cleanupDestroyedListener = (browserWindowId: number): void => {
      destroyedListenerCleanups.get(browserWindowId)?.();
    };

    yield* Effect.acquireRelease(
      coordinator.onSessionEnded((event) =>
        ipc.sendToBrowserWindowIds(event.participantIds, ArmyIpc.ended, {
          reason: event.reason,
          sessionId: event.sessionId,
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );

    yield* Effect.acquireRelease(
      windows.onCreated((event) =>
        event.kind === "game"
          ? Effect.sync(() => {
              cleanupDestroyedListener(event.browserWindowId);

              const handleDestroyed = (): void => {
                cleanupDestroyedListener(event.browserWindowId);
                runFork(
                  coordinator.abortParticipant(
                    event.browserWindowId,
                    "Army window destroyed",
                  ),
                );
              };
              const cleanup = (): void => {
                event.window.webContents.off("destroyed", handleDestroyed);
                destroyedListenerCleanups.delete(event.browserWindowId);
              };

              event.window.webContents.on("destroyed", handleDestroyed);
              destroyedListenerCleanups.set(event.browserWindowId, cleanup);
            })
          : Effect.void,
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );

    yield* Effect.acquireRelease(
      windows.onClosed((event) =>
        event.kind === "game"
          ? Effect.gen(function* () {
              yield* Effect.sync(() =>
                cleanupDestroyedListener(event.browserWindowId),
              );
              yield* coordinator.abortParticipant(
                event.browserWindowId,
                "Army window closed",
              );
            })
          : Effect.void,
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const cleanup of destroyedListenerCleanups.values()) {
          cleanup();
        }
      }),
    );
  },
);
