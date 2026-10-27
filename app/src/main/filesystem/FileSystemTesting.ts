import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { FileSystem } from "effect/FileSystem";
import * as Layer from "effect/Layer";

export const fileSystemLayer = (
  override: (real: FileSystem) => Partial<FileSystem> = () => ({}),
): Layer.Layer<FileSystem> =>
  Layer.effect(
    FileSystem,
    Effect.map(FileSystem, (real) =>
      FileSystem.of({ ...real, ...override(real) }),
    ),
  ).pipe(Layer.provide(NodeFileSystem.layer));
