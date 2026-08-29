import { randomBytes } from "crypto";
import { dirname } from "path";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import {
  type DesktopFileSystem,
  type DesktopFileSystemError,
} from "./DesktopFileSystem";

/** Publishes through a same-directory rename; visibility is atomic, durability is not. */
export const makeAtomicFile = (fileSystem: DesktopFileSystem["Service"]) => {
  const removeTemp = (path: string) =>
    fileSystem.removeFile(path, { ifMissing: "ignore" }).pipe(Effect.ignore);

  const write = Effect.fn("AtomicFile.write")(function* (
    path: string,
    data: string | Uint8Array,
    options: { readonly mode?: number } = {},
  ): Effect.fn.Return<void, DesktopFileSystemError> {
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${randomBytes(16).toString("hex")}.tmp`;

    const createTemp = fileSystem
      .writeFile(tempPath, data, {
        disposition: "create-new",
        ...(options.mode === undefined ? {} : { mode: options.mode }),
      })
      .pipe(
        Effect.tapError((error) =>
          error.reason === "AlreadyExists" ? Effect.void : removeTemp(tempPath),
        ),
        Effect.as(tempPath),
      );

    yield* Effect.acquireUseRelease(
      createTemp,
      (temporaryPath) => fileSystem.rename(temporaryPath, path),
      (temporaryPath, exit) =>
        Exit.isSuccess(exit) ? Effect.void : removeTemp(temporaryPath),
    );
  });

  return { write };
};
