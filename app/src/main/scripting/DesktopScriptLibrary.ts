import { promises as fs } from "fs";
import { basename } from "path";

import { Context, Effect, Layer, Schema } from "effect";

import type {
  ScriptFile,
  ScriptFileResolution,
  ScriptOpenFileResult,
  ScriptSelectFileResult,
} from "@lucent/core/scriptInputs";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ElectronDialog } from "../electron/ElectronDialog";
import { ElectronShell } from "../electron/ElectronShell";
import { ScriptFiles } from "../internal/scripting/ScriptFiles";

const scriptLibraryOperationSchema = Schema.Literals(["mkdir", "open", "read"]);

export class DesktopScriptLibraryError extends Schema.TaggedErrorClass<DesktopScriptLibraryError>()(
  "DesktopScriptLibraryError",
  {
    operation: scriptLibraryOperationSchema,
    path: Schema.optionalKey(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.path === undefined
      ? `Script library ${this.operation} failed.`
      : `Script library ${this.operation} failed at ${this.path}.`;
  }
}

export interface DesktopScriptLibraryShape {
  readonly openFile: Effect.Effect<
    ScriptOpenFileResult,
    DesktopScriptLibraryError
  >;
  readonly openPath: (path: string) => Effect.Effect<boolean>;
  readonly readFile: (
    path: string,
  ) => Effect.Effect<ScriptFile, DesktopScriptLibraryError>;
  readonly resolveFile: (path: string) => Effect.Effect<ScriptFileResolution>;
  readonly selectFile: Effect.Effect<
    ScriptSelectFileResult,
    DesktopScriptLibraryError
  >;
}

export class DesktopScriptLibrary extends Context.Service<
  DesktopScriptLibrary,
  DesktopScriptLibraryShape
>()("lucent/desktop/scripting/DesktopScriptLibrary") {}

const wrapError = (
  operation: typeof scriptLibraryOperationSchema.Type,
  cause: unknown,
  path?: string,
) =>
  new DesktopScriptLibraryError({
    operation,
    cause,
    ...(path === undefined ? {} : { path }),
  });

const ensureDirectory = (
  path: string,
): Effect.Effect<void, DesktopScriptLibraryError> =>
  Effect.tryPromise({
    try: () => fs.mkdir(path, { recursive: true }),
    catch: (cause) => wrapError("mkdir", cause, path),
  }).pipe(Effect.asVoid);

export const layer = Layer.effect(
  DesktopScriptLibrary,
  Effect.gen(function* () {
    const dialog = yield* ElectronDialog;
    const env = yield* DesktopEnvironment;
    const files = yield* ScriptFiles;
    const shell = yield* ElectronShell;

    const readFile = (path: string) =>
      files
        .read(path)
        .pipe(Effect.mapError((cause) => wrapError("read", cause, path)));

    const selectPath = Effect.gen(function* () {
      yield* ensureDirectory(env.scriptsDir);
      const result = yield* dialog
        .showOpenDialog({
          buttonLabel: "Load Script",
          defaultPath: env.scriptsDir,
          filters: [
            { extensions: ["js", "cjs"], name: "JavaScript Scripts" },
            { extensions: ["*"], name: "All Files" },
          ],
          properties: ["openFile"],
          title: "Load Script",
        })
        .pipe(Effect.mapError((cause) => wrapError("open", cause)));

      const [path] = result.filePaths;
      if (result.canceled || path === undefined) {
        return null;
      }

      return path;
    });

    const selectFile: DesktopScriptLibraryShape["selectFile"] = Effect.gen(
      function* () {
        const path = yield* selectPath;
        return path === null
          ? ({ canceled: true } satisfies ScriptSelectFileResult)
          : ({
              canceled: false,
              file: { name: basename(path), path },
            } satisfies ScriptSelectFileResult);
      },
    );

    const openFile: DesktopScriptLibraryShape["openFile"] = Effect.gen(
      function* () {
        const path = yield* selectPath;
        if (path === null) {
          return { canceled: true } satisfies ScriptOpenFileResult;
        }

        const file = yield* readFile(path);
        return { canceled: false, file } satisfies ScriptOpenFileResult;
      },
    );

    const openPath: DesktopScriptLibraryShape["openPath"] = (path) =>
      shell.openPath(path);

    return DesktopScriptLibrary.of({
      openFile,
      openPath,
      readFile,
      resolveFile: files.resolve,
      selectFile,
    });
  }),
);
