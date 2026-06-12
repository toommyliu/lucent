import { Effect, Scope } from "effect";
import { WindowIpcContracts } from "../../../shared/ipc";
import { WindowService } from "../../window/WindowService";
import { MainIpc } from "../MainIpc";
import {
  getSenderGameWindowIds,
  getSenderWindowId,
  requireGameWindowSender,
  requireWindowOpenSender,
} from "../SenderAuthorization";

export const registerWindowIpcHandlers = (): Effect.Effect<
  void,
  never,
  MainIpc | Scope.Scope | WindowService
> =>
  Effect.gen(function* () {
    const ipc = yield* MainIpc;

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
          const { gameWindowId } = yield* getSenderGameWindowIds(event.sender);
          const windows = yield* WindowService;
          yield* windows.requestCloseGameWindow(gameWindowId);
        }),
    );
  });
