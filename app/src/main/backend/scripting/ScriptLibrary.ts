import { promises as fs } from "fs";
import { basename, sep } from "path";
import { Data, Effect, Layer, ServiceMap } from "effect";
import type { ScriptExecutePayload } from "../../../shared/ipc";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";

export class ScriptLibraryError extends Data.TaggedError("ScriptLibraryError")<{
  readonly operation: "resolve" | "read" | "refresh";
  readonly path: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Could not ${this.operation} script: ${this.path}`;
  }
}

export interface ScriptLibraryShape {
  readonly scriptsDir: string;
  readonly resolvePath: (
    path: string,
  ) => Effect.Effect<string, ScriptLibraryError>;
  readonly read: (
    path: string,
  ) => Effect.Effect<ScriptExecutePayload, ScriptLibraryError>;
  readonly refresh: (
    payload: ScriptExecutePayload,
  ) => Effect.Effect<ScriptExecutePayload, ScriptLibraryError>;
}

export class ScriptLibrary extends ServiceMap.Service<
  ScriptLibrary,
  ScriptLibraryShape
>()("main/backend/scripting/ScriptLibrary") {}

export const resolveScriptPath = async (
  scriptsPath: string,
  path: string,
): Promise<string> => {
  await fs.mkdir(scriptsPath, { recursive: true });

  const [scriptsRoot, scriptPath] = await Promise.all([
    fs.realpath(scriptsPath),
    fs.realpath(path),
  ]);

  if (
    scriptPath !== scriptsRoot &&
    !scriptPath.startsWith(`${scriptsRoot}${sep}`)
  ) {
    throw new Error("Script path must be inside the scripts directory");
  }

  return scriptPath;
};

export const readScriptPayload = async (
  scriptsPath: string,
  path: string,
): Promise<ScriptExecutePayload> => {
  const scriptPath = await resolveScriptPath(scriptsPath, path);
  return {
    source: await fs.readFile(scriptPath, "utf8"),
    path: scriptPath,
    name: basename(scriptPath),
  };
};

export const refreshScriptPayload = async (
  scriptsPath: string,
  payload: ScriptExecutePayload,
): Promise<ScriptExecutePayload> => {
  const path = payload.path?.trim();
  if (!path) {
    return payload;
  }

  return await readScriptPayload(scriptsPath, path);
};

export const makeScriptLibrary = (scriptsDir: string): ScriptLibraryShape => {
  const resolvePath: ScriptLibraryShape["resolvePath"] = (path) =>
    Effect.tryPromise({
      try: () => resolveScriptPath(scriptsDir, path),
      catch: (cause) =>
        new ScriptLibraryError({ operation: "resolve", path, cause }),
    });

  const read: ScriptLibraryShape["read"] = (path) =>
    Effect.tryPromise({
      try: () => readScriptPayload(scriptsDir, path),
      catch: (cause) =>
        new ScriptLibraryError({ operation: "read", path, cause }),
    });

  const refresh: ScriptLibraryShape["refresh"] = (payload) =>
    Effect.tryPromise({
      try: () => refreshScriptPayload(scriptsDir, payload),
      catch: (cause) =>
        new ScriptLibraryError({
          operation: "refresh",
          path: payload.path ?? payload.name ?? "<inline script>",
          cause,
        }),
    });

  return {
    scriptsDir,
    resolvePath,
    read,
    refresh,
  };
};

export const layer = Layer.effect(ScriptLibrary)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    return makeScriptLibrary(env.scriptsDir);
  }),
);
