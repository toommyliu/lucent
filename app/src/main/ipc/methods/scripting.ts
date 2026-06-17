import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import { Effect, Scope } from "effect";
import {
  ScriptingIpcChannels,
  type ScriptExecutePayload,
} from "../../../shared/ipc";
import { DesktopIpc } from "../DesktopIpc";
import { requireScriptingSender } from "../DesktopIpcRequest";
import { WindowService } from "../../window/WindowService";
import { ScriptLibrary } from "../../backend/scripting/ScriptLibrary";

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

export const registerScriptingIpcHandlers = (): Effect.Effect<
  void,
  never,
  DesktopIpc | Scope.Scope | WindowService | ScriptLibrary
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
  });
