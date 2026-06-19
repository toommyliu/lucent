import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import { Data, Effect, Scope } from "effect";
import {
  ScriptingIpcChannels,
  type ScriptExecutePayload,
} from "../../../shared/ipc";
import {
  normalizeScriptInputsDefinition,
  normalizeScriptInputValues,
} from "../../../shared/script-inputs";
import { DesktopIpc } from "../DesktopIpc";
import { requireScriptingSender } from "../DesktopIpcRequest";
import { WindowService } from "../../window/WindowService";
import { ScriptLibrary } from "../../backend/scripting/ScriptLibrary";
import { ScriptInputRepository } from "../../backend/scripting/ScriptInputRepository";

class ScriptInputDefinitionError extends Data.TaggedError(
  "ScriptInputDefinitionError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error && this.cause.message !== ""
      ? this.cause.message
      : "Invalid script input definition";
  }
}

const getEventWindow = (senderId?: number): BrowserWindow | null => {
  if (senderId !== undefined) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.id === senderId) {
        return win;
      }
    }
  }

  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    return focused;
  }

  const [first] = BrowserWindow.getAllWindows();
  return first ?? null;
};

const openScriptDialog = async (
  win: BrowserWindow | null,
  scriptsDir: string,
): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: "Open script",
    defaultPath: scriptsDir,
    filters: [
      { name: "JavaScript", extensions: ["js", "cjs"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  };

  const result =
    win === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(win, options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
};

const normalizeScriptInputsDefinitionEffect = (input: unknown) =>
  Effect.try({
    try: () => normalizeScriptInputsDefinition(input),
    catch: (cause) => new ScriptInputDefinitionError({ cause }),
  });

export const registerScriptingIpcHandlers = (): Effect.Effect<
  void,
  never,
  | DesktopIpc
  | Scope.Scope
  | WindowService
  | ScriptLibrary
  | ScriptInputRepository
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;

    yield* ipc.handle(ScriptingIpcChannels.openFile, (event) =>
      Effect.gen(function* () {
        yield* requireScriptingSender(event.sender);
        const scripts = yield* ScriptLibrary;
        const path = yield* Effect.promise(() =>
          openScriptDialog(getEventWindow(event.sender.id), scripts.scriptsDir),
        );
        if (path === null) {
          return null;
        }

        return yield* scripts.read(path);
      }),
    );

    yield* ipc.handle(ScriptingIpcChannels.readFile, (event, path) =>
      Effect.gen(function* () {
        yield* requireScriptingSender(event.sender);
        if (typeof path !== "string" || path.trim() === "") {
          return yield* Effect.fail(new Error("Invalid script path"));
        }

        const scripts = yield* ScriptLibrary;
        return (yield* scripts.read(
          path.trim(),
        )) satisfies ScriptExecutePayload;
      }),
    );

    yield* ipc.handle(ScriptingIpcChannels.openPath, (event, path) =>
      Effect.gen(function* () {
        yield* requireScriptingSender(event.sender);
        if (typeof path !== "string" || path.trim() === "") {
          return yield* Effect.fail(new Error("Invalid script path"));
        }

        const scripts = yield* ScriptLibrary;
        const scriptPath = yield* scripts.resolvePath(path.trim());
        const openError = yield* Effect.promise(() =>
          shell.openPath(scriptPath),
        );
        if (openError !== "") {
          return yield* Effect.fail(new Error(openError));
        }
      }),
    );

    yield* ipc.handle(ScriptingIpcChannels.getInputValues, (event, input) =>
      Effect.gen(function* () {
        yield* requireScriptingSender(event.sender);
        const definition = yield* normalizeScriptInputsDefinitionEffect(input);
        const repository = yield* ScriptInputRepository;
        return yield* repository.get(definition);
      }),
    );

    yield* ipc.handle(
      ScriptingIpcChannels.saveInputValues,
      (event, input, values) =>
        Effect.gen(function* () {
          yield* requireScriptingSender(event.sender);
          const definition =
            yield* normalizeScriptInputsDefinitionEffect(input);
          const repository = yield* ScriptInputRepository;
          return yield* repository.set(
            definition,
            normalizeScriptInputValues(values),
          );
        }),
    );
  });
