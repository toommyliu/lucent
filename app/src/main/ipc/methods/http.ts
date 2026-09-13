import * as Effect from "effect/Effect";

import { HttpIpc } from "../../../shared/ipc/http";
import { ScriptHttp } from "../../scripting/ScriptHttp";
import { makeDesktopIpcMethod } from "../DesktopIpc";

const openSession = makeDesktopIpcMethod({
  descriptor: HttpIpc.openSession,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.http.openSession")(
    function* (_payload, sender) {
      const http = yield* ScriptHttp;
      return yield* http.openSession(sender.rendererId);
    },
  ),
});
const closeSession = makeDesktopIpcMethod({
  descriptor: HttpIpc.closeSession,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.http.closeSession")(
    function* (payload, sender) {
      const http = yield* ScriptHttp;
      yield* http.closeSession(sender.rendererId, payload.sessionId);
    },
  ),
});
const request = makeDesktopIpcMethod({
  descriptor: HttpIpc.request,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.http.request")(function* (payload, sender) {
    const http = yield* ScriptHttp;
    return yield* http.request(sender.rendererId, payload);
  }),
});
const cancel = makeDesktopIpcMethod({
  descriptor: HttpIpc.cancel,
  allowedSenders: ["game"],
  handler: Effect.fn("desktop.ipc.http.cancel")(function* (payload, sender) {
    const http = yield* ScriptHttp;
    yield* http.cancel(sender.rendererId, payload.sessionId, payload.requestId);
  }),
});

export const methods = [openSession, closeSession, request, cancel] as const;
