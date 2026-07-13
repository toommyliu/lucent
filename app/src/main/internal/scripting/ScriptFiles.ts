import { promises as fs } from "fs";
import { basename } from "path";

import { Context, Effect, Layer, Schema } from "effect";

import type { ScriptFile } from "@lucent/core/scriptInputs";
import { ScriptInputsExtractor } from "./ScriptInputsExtractor";

export class ScriptFilesError extends Schema.TaggedErrorClass<ScriptFilesError>()(
  "ScriptFilesError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Script file read failed at ${this.path}.`;
  }
}

export interface ScriptFilesShape {
  readonly read: (path: string) => Effect.Effect<ScriptFile, ScriptFilesError>;
}

export class ScriptFiles extends Context.Service<
  ScriptFiles,
  ScriptFilesShape
>()("lucent/internal/scripting/ScriptFiles") {}

export const layer = Layer.effect(
  ScriptFiles,
  Effect.gen(function* () {
    const extractor = yield* ScriptInputsExtractor;

    const read = (path: string) =>
      Effect.gen(function* () {
        const source = yield* Effect.tryPromise({
          try: () => fs.readFile(path, "utf8"),
          catch: (cause) => new ScriptFilesError({ cause, path }),
        });
        const inputs = yield* extractor.extract(source, path);
        return {
          inputs,
          name: basename(path),
          path,
          source,
        } satisfies ScriptFile;
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof ScriptFilesError
            ? cause
            : new ScriptFilesError({ cause, path }),
        ),
      );

    return ScriptFiles.of({
      read,
    });
  }),
);
