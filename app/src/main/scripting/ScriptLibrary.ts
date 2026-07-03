import { promises as fs } from "fs";
import { basename } from "path";

import { Context, Effect, Layer, Schema } from "effect";

import type {
  ScriptFile,
  ScriptOpenFileResult,
} from "../../shared/ipc/scripting";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { ElectronDialog } from "../electron/ElectronDialog";
import { ElectronShell } from "../electron/ElectronShell";
import { ScriptInputsExtractor } from "./ScriptInputsExtractor";

const scriptLibraryOperationSchema = Schema.Literals(["mkdir", "open", "read"]);

export class ScriptLibraryError extends Schema.TaggedErrorClass<ScriptLibraryError>()(
  "ScriptLibraryError",
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

export interface ScriptLibraryShape {
  readonly openFile: Effect.Effect<ScriptOpenFileResult, ScriptLibraryError>;
  readonly openPath: (path: string) => Effect.Effect<boolean>;
  readonly readFile: (
    path: string,
  ) => Effect.Effect<ScriptFile, ScriptLibraryError>;
}

export class ScriptLibrary extends Context.Service<
  ScriptLibrary,
  ScriptLibraryShape
>()("lucent/desktop/scripting/ScriptLibrary") {}

const wrapError = (
  operation: typeof scriptLibraryOperationSchema.Type,
  cause: unknown,
  path?: string,
) =>
  new ScriptLibraryError({
    operation,
    cause,
    ...(path === undefined ? {} : { path }),
  });

const ensureDirectory = (
  path: string,
): Effect.Effect<void, ScriptLibraryError> =>
  Effect.tryPromise({
    try: () => fs.mkdir(path, { recursive: true }),
    catch: (cause) => wrapError("mkdir", cause, path),
  }).pipe(Effect.asVoid);

const readText = (path: string): Effect.Effect<string, ScriptLibraryError> =>
  Effect.tryPromise({
    try: () => fs.readFile(path, "utf8"),
    catch: (cause) => wrapError("read", cause, path),
  });

export const layer = Layer.effect(
  ScriptLibrary,
  Effect.gen(function* () {
    const dialog = yield* ElectronDialog;
    const env = yield* DesktopEnvironment;
    const extractor = yield* ScriptInputsExtractor;
    const shell = yield* ElectronShell;

    const readFile = (path: string) =>
      Effect.gen(function* () {
        const source = yield* readText(path);
        const inputs = yield* extractor.extract(source, path);
        return {
          inputs,
          name: basename(path),
          path,
          source,
        } satisfies ScriptFile;
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof ScriptLibraryError
            ? cause
            : wrapError("read", cause, path),
        ),
      );

    return ScriptLibrary.of({
      openFile: Effect.gen(function* () {
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
          return { canceled: true } satisfies ScriptOpenFileResult;
        }

        const file = yield* readFile(path);
        return { canceled: false, file } satisfies ScriptOpenFileResult;
      }),
      openPath: (path) => shell.openPath(path),
      readFile,
    });
  }),
);
