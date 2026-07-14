import { Effect } from "effect";

import { UpdatesIpc } from "../../../shared/ipc";
import { DesktopUpdates } from "../../updates/DesktopUpdates";
import { DesktopIpc, makeDesktopIpcMethod } from "../DesktopIpc";

const updateSenders = ["settings"] as const;

export const getState = makeDesktopIpcMethod({
  descriptor: UpdatesIpc.getState,
  allowedSenders: updateSenders,
  handler: Effect.fn("desktop.ipc.updates.getState")(function* () {
    const updates = yield* DesktopUpdates;
    return yield* updates.getState;
  }),
});

export const checkNow = makeDesktopIpcMethod({
  descriptor: UpdatesIpc.checkNow,
  allowedSenders: updateSenders,
  handler: Effect.fn("desktop.ipc.updates.checkNow")(function* (payload) {
    const updates = yield* DesktopUpdates;
    return yield* updates.checkNow({ force: payload.force === true });
  }),
});

export const openReleasePage = makeDesktopIpcMethod({
  descriptor: UpdatesIpc.openReleasePage,
  allowedSenders: updateSenders,
  handler: Effect.fn("desktop.ipc.updates.openReleasePage")(function* () {
    const updates = yield* DesktopUpdates;
    return yield* updates.openReleasePage;
  }),
});

export const methods = [getState, checkNow, openReleasePage] as const;

export const installEventForwarding = Effect.fn(
  "desktop.ipc.updates.installEventForwarding",
)(function* () {
  const ipc = yield* DesktopIpc;
  const updates = yield* DesktopUpdates;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);

  yield* Effect.acquireRelease(
    updates.onStateChanged((state) => {
      void runPromise(ipc.sendToAll(UpdatesIpc.changed, state));
    }),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
});
