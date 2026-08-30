import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  FileSystemError as CoreFileSystemError,
  SCRIPT_FILE_SYSTEM_MAX_BYTES,
  type FileSystemErrorReason,
  type FileSystemOperation,
} from "@lucent/core/filesystem";
import type {
  DesktopFileSystemBridge,
  DesktopFileSystemResult,
} from "../../../../shared/desktopBridge";
import type { ScriptFileSystemApi } from "./ScriptApi";
import type { ScriptAsyncScope } from "./scriptAsyncScope";

class ScriptFileSystemSessionError extends Error {
  override readonly name = "ScriptFileSystemSessionError";

  constructor(override readonly cause: unknown) {
    super("The script filesystem session could not be opened.");
  }
}

const makeError = (
  operation: FileSystemOperation,
  reason: FileSystemErrorReason,
  path?: string,
): CoreFileSystemError =>
  new CoreFileSystemError({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });

const isJson = Schema.is(Schema.Json);
const utf8Encoder = new TextEncoder();

export const makeScriptFileSystemApi = Effect.fn("ScriptFileSystemApi.make")(
  function* (
    bridge: DesktopFileSystemBridge,
    scope: ScriptAsyncScope,
  ): Effect.fn.Return<ScriptFileSystemApi, ScriptFileSystemSessionError> {
    const openSession = Effect.tryPromise({
      try: () => bridge.openSession(),
      catch: (cause) => new ScriptFileSystemSessionError(cause),
    });
    const closeSession = (sessionId: string) =>
      Effect.tryPromise({
        try: () => bridge.closeSession(sessionId),
        catch: (cause) => new ScriptFileSystemSessionError(cause),
      });
    let closed = false;

    const sessionId = yield* Effect.acquireUseRelease(
      openSession,
      (openedSessionId) =>
        scope
          .addCleanup(() => {
            closed = true;
            return closeSession(openedSessionId);
          })
          .pipe(Effect.as(openedSessionId)),
      (openedSessionId, exit) =>
        Exit.isSuccess(exit) ? Effect.void : closeSession(openedSessionId),
    );

    const request = <A>(
      operation: FileSystemOperation,
      path: string | undefined,
      invoke: () => Promise<DesktopFileSystemResult<A>>,
      validate?: () => CoreFileSystemError | undefined,
    ): Effect.Effect<A, CoreFileSystemError> =>
      Effect.suspend(() => {
        if (closed || scope.signal.aborted) {
          return Effect.fail(makeError(operation, "session-closed", path));
        }
        const validationError = validate?.();
        if (validationError !== undefined) {
          return Effect.fail(validationError);
        }
        return Effect.tryPromise({
          try: invoke,
          catch: () => makeError(operation, "unavailable", path),
        }).pipe(
          Effect.flatMap((result) =>
            result.ok
              ? Effect.succeed(result.value)
              : Effect.fail(
                  makeError(
                    result.error.operation,
                    result.error.reason,
                    result.error.path,
                  ),
                ),
          ),
        );
      });

    const api: ScriptFileSystemApi = {
      FileSystemError: CoreFileSystemError,
      exists: (path) =>
        request("exists", path, () => bridge.exists(sessionId, path)),
      list: (path) =>
        request("list", path, () => bridge.list(sessionId, path)).pipe(
          Effect.map((entries) =>
            Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
          ),
        ),
      readJson: (path) =>
        request("read-json", path, () => bridge.readJson(sessionId, path)),
      readText: (path) =>
        request("read-text", path, () => bridge.readText(sessionId, path)),
      remove: (path) =>
        request("remove", path, () => bridge.remove(sessionId, path)),
      writeJson: (path, value) =>
        request(
          "write-json",
          path,
          () => bridge.writeJson(sessionId, path, value),
          () => {
            if (!isJson(value)) {
              return makeError("write-json", "not-json-serializable", path);
            }
            const source = `${JSON.stringify(value, null, 2)}\n`;
            return utf8Encoder.encode(source).byteLength >
              SCRIPT_FILE_SYSTEM_MAX_BYTES
              ? makeError("write-json", "too-large", path)
              : undefined;
          },
        ),
      writeText: (path, contents) =>
        request(
          "write-text",
          path,
          () => bridge.writeText(sessionId, path, contents),
          () =>
            utf8Encoder.encode(contents).byteLength >
            SCRIPT_FILE_SYSTEM_MAX_BYTES
              ? makeError("write-text", "too-large", path)
              : undefined,
        ),
    };
    return Object.freeze(api);
  },
);
