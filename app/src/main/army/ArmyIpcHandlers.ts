import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { Effect } from "effect";

import { ArmyIpc } from "../../shared/ipc";
import { DesktopIpc } from "../ipc/DesktopIpc";
import { ArmyConfigRepository } from "./ArmyConfigRepository";
import { ArmyCoordinator } from "./ArmyCoordinator";

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

  yield* ipc.handle(ArmyIpc.loadConfig, (payload) =>
    configs.read(payload.configName),
  );

  yield* ipc.handle(ArmyIpc.start, (payload, event) =>
    Effect.gen(function* () {
      const [config, sender] = yield* Effect.all([
        configs.read(payload.configName),
        senderWindow(event),
      ]);
      return yield* coordinator.join(config, payload.playerName, sender);
    }),
  );

  yield* ipc.handle(ArmyIpc.leave, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) => coordinator.leave(payload.sessionId, sender)),
    ),
  );

  yield* ipc.handle(ArmyIpc.sync, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) =>
        coordinator.sync(payload.sessionId, sender, payload),
      ),
    ),
  );

  yield* ipc.handle(ArmyIpc.progress, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) =>
        coordinator.progress(payload.sessionId, sender, payload),
      ),
    ),
  );

  yield* ipc.handle(ArmyIpc.fail, (payload, event) =>
    senderWindow(event).pipe(
      Effect.flatMap((sender) =>
        coordinator.fail(payload.sessionId, sender, payload.reason),
      ),
    ),
  );
});
