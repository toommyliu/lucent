import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import { Effect, Scope } from "effect";
import {
  ScriptingIpcChannels,
  type ScriptExecutePayload,
} from "../../../shared/ipc";
import { MainIpc } from "../MainIpc";
import { requireScriptingSender } from "../SenderAuthorization";
import { WindowService } from "../../window/WindowService";
import { WorkspaceFiles } from "../../workspace/WorkspaceFiles";
import { resolveScriptPath } from "../../workspace/scripting";

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
  MainIpc | Scope.Scope | WindowService | WorkspaceFiles
> =>
  Effect.gen(function* () {
    const ipc = yield* MainIpc;

    yield* ipc.handle(ScriptingIpcChannels.openFile, (event) =>
      Effect.gen(function* () {
        yield* requireScriptingSender(event.sender);
        const workspace = yield* WorkspaceFiles;
        const path = yield* Effect.promise(() =>
          openScriptDialog(
            getEventWindow(event.sender.id),
            workspace.scriptsDir,
          ),
        );
        if (path === null) {
          return null;
        }

        return yield* workspace.readScript(path);
      }),
    );

    yield* ipc.handle(ScriptingIpcChannels.readFile, (event, path) =>
      Effect.gen(function* () {
        yield* requireScriptingSender(event.sender);
        if (typeof path !== "string" || path.trim() === "") {
          return yield* Effect.fail(new Error("Invalid script path"));
        }

        const workspace = yield* WorkspaceFiles;
        return (yield* workspace.readScript(
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

        const workspace = yield* WorkspaceFiles;
        const scriptPath = yield* Effect.tryPromise({
          try: () => resolveScriptPath(workspace.scriptsDir, path.trim()),
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        });
        const openError = yield* Effect.promise(() =>
          shell.openPath(scriptPath),
        );
        if (openError !== "") {
          return yield* Effect.fail(new Error(openError));
        }
      }),
    );
  });
