import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { Effect } from "effect";

import { ArmyIpc } from "../../shared/ipc";
import { ArmyConfigRepository } from "./ArmyConfigRepository";
import { ArmyCoordinator } from "./ArmyCoordinator";
import { DesktopIpc } from "../ipc/DesktopIpc";

const getSenderWindow = (event: IpcMainInvokeEvent): BrowserWindow => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === null) {
    throw new Error("Army IPC requires a sender window");
  }

  return window;
};

class ArmyIpcHandlerError extends Error {
  readonly _tag = "ArmyIpcHandlerError";
}

export const installArmyIpcHandlers = Effect.gen(function* () {
  const configs = yield* ArmyConfigRepository;
  const coordinator = yield* ArmyCoordinator;
  const ipc = yield* DesktopIpc;

  yield* ipc.handle(ArmyIpc.loadConfig, (payload) =>
    configs.read(payload.configName),
  );

  yield* ipc.handle(ArmyIpc.start, (payload, event) =>
    Effect.gen(function* () {
      const config = yield* configs.read(payload.configName);
      const session = coordinator.getOrCreateSession(config);
      return yield* Effect.promise(() =>
        coordinator.join(session, payload.playerName, getSenderWindow(event)),
      );
    }),
  );

  yield* ipc.handle(ArmyIpc.leave, (payload) =>
    Effect.sync(() => {
      coordinator.leave(payload.sessionId, payload.playerName);
    }),
  );

  yield* ipc.handle(ArmyIpc.sync, (payload) =>
    Effect.gen(function* () {
      const session = coordinator.getSession(payload.sessionId);
      if (session === undefined) {
        return yield* Effect.fail(
          new ArmyIpcHandlerError("Army session is not active"),
        );
      }

      yield* Effect.promise(() =>
        coordinator.waitAtSync(session, payload.playerName, payload),
      );
    }),
  );

  yield* ipc.handle(ArmyIpc.progress, (payload) =>
    Effect.gen(function* () {
      const session = coordinator.getSession(payload.sessionId);
      if (session === undefined) {
        return yield* Effect.fail(
          new ArmyIpcHandlerError("Army session is not active"),
        );
      }

      return yield* Effect.promise(() =>
        coordinator.waitAtProgress(session, payload.playerName, payload),
      );
    }),
  );

  yield* ipc.handle(ArmyIpc.fail, (payload) =>
    Effect.sync(() => {
      coordinator.failSession(
        payload.sessionId,
        payload.playerName,
        payload.reason,
      );
    }),
  );
});
