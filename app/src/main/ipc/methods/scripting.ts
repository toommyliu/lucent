import * as Effect from "effect/Effect";

import { ScriptingIpc } from "../../../shared/ipc";
import { ScriptInputRepository } from "../../internal/scripting/ScriptInputRepository";
import { DesktopScriptLibrary } from "../../scripting/DesktopScriptLibrary";
import { makeDesktopIpcMethod } from "../DesktopIpc";

const scriptingSenders = ["account-manager", "game"] as const;

export const openFile = makeDesktopIpcMethod({
  descriptor: ScriptingIpc.openFile,
  allowedSenders: scriptingSenders,
  handler: Effect.fn("desktop.ipc.scripting.openFile")(function* () {
    const scripts = yield* DesktopScriptLibrary;
    return yield* scripts.openFile;
  }),
});

export const readFile = makeDesktopIpcMethod({
  descriptor: ScriptingIpc.readFile,
  allowedSenders: scriptingSenders,
  handler: Effect.fn("desktop.ipc.scripting.readFile")(function* (payload) {
    const scripts = yield* DesktopScriptLibrary;
    return yield* scripts.readFile(payload.path);
  }),
});

export const resolveFile = makeDesktopIpcMethod({
  descriptor: ScriptingIpc.resolveFile,
  allowedSenders: scriptingSenders,
  handler: Effect.fn("desktop.ipc.scripting.resolveFile")(function* (payload) {
    const scripts = yield* DesktopScriptLibrary;
    return yield* scripts.resolveFile(payload.path);
  }),
});

export const selectFile = makeDesktopIpcMethod({
  descriptor: ScriptingIpc.selectFile,
  allowedSenders: scriptingSenders,
  handler: Effect.fn("desktop.ipc.scripting.selectFile")(function* () {
    const scripts = yield* DesktopScriptLibrary;
    return yield* scripts.selectFile;
  }),
});

export const openPath = makeDesktopIpcMethod({
  descriptor: ScriptingIpc.openPath,
  allowedSenders: scriptingSenders,
  handler: Effect.fn("desktop.ipc.scripting.openPath")(function* (payload) {
    const scripts = yield* DesktopScriptLibrary;
    return yield* scripts.openPath(payload.path);
  }),
});

export const getInputValues = makeDesktopIpcMethod({
  descriptor: ScriptingIpc.getInputValues,
  allowedSenders: scriptingSenders,
  handler: Effect.fn("desktop.ipc.scripting.getInputValues")(
    function* (definition) {
      const scriptInputs = yield* ScriptInputRepository;
      return yield* scriptInputs.getValues(definition);
    },
  ),
});

export const saveInputValues = makeDesktopIpcMethod({
  descriptor: ScriptingIpc.saveInputValues,
  allowedSenders: scriptingSenders,
  handler: Effect.fn("desktop.ipc.scripting.saveInputValues")(
    function* (payload) {
      const scriptInputs = yield* ScriptInputRepository;
      return yield* scriptInputs.saveValues(payload.definition, payload.values);
    },
  ),
});

export const methods = [
  openFile,
  readFile,
  resolveFile,
  selectFile,
  openPath,
  getInputValues,
  saveInputValues,
] as const;
