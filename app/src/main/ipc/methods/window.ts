import { Effect, Scope } from "effect";
import { WindowIpcContracts } from "../../../shared/ipc";
import { WindowService } from "../../window/WindowService";
import { DesktopIpc } from "../DesktopIpc";
import {
  getSenderGameWindow,
  getSenderWindowId,
  requireGameWindowSender,
  requireWindowOpenSender,
} from "../DesktopIpcRequest";

export const registerWindowIpcHandlers = (): Effect.Effect<
  void,
  never,
  DesktopIpc | Scope.Scope | WindowService
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;

    yield* ipc.handleContract(WindowIpcContracts.open, (event, id) =>
      Effect.gen(function* () {
        yield* requireWindowOpenSender(event.sender, id);
        const senderWindowId = getSenderWindowId(event.sender);
        const windows = yield* WindowService;
        yield* windows.openWindow(id, senderWindowId);
      }),
    );

    yield* ipc.handleContract(
      WindowIpcContracts.requestCloseGameWindow,
      (event) =>
        Effect.gen(function* () {
          yield* requireGameWindowSender(event.sender);
          const { gameWindow } = yield* getSenderGameWindow(event.sender);
          const windows = yield* WindowService;
          yield* windows.requestCloseGameWindow(gameWindow);
        }),
    );
  });
