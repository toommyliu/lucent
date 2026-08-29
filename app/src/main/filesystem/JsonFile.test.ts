import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { expect, layer as testLayer } from "@effect/vitest";
import { afterEach } from "vitest";
import * as Effect from "effect/Effect";

import { DesktopFileSystem } from "./DesktopFileSystem";
import { layer } from "./DesktopFileSystemNode";
import { JSON_FILE_MAX_BYTES, makeJsonFile } from "./JsonFile";

const fixtureDirectories = new Set<string>();

const makeFixture = async (): Promise<string> => {
  const path = await fs.mkdtemp(join(tmpdir(), "lucent-json-file-"));
  fixtureDirectories.add(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    [...fixtureDirectories].map((path) =>
      fs.rm(path, { recursive: true, force: true }),
    ),
  );
  fixtureDirectories.clear();
});

testLayer(layer)("JsonFile", (it) => {
  it.effect("distinguishes missing files and preserves the JSON format", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const path = join(root, "nested", "state.json");
      const fileSystem = yield* DesktopFileSystem;
      const jsonFile = makeJsonFile(fileSystem);

      expect(yield* jsonFile.read(path)).toEqual({ status: "missing" });
      yield* jsonFile.write(path, { enabled: true, count: 2 });

      expect(yield* Effect.promise(() => fs.readFile(path, "utf8"))).toBe(
        '{\n  "enabled": true,\n  "count": 2\n}\n',
      );
      expect(yield* jsonFile.read(path)).toEqual({
        status: "ok",
        value: { enabled: true, count: 2 },
      });
    }),
  );

  it.effect("reports parsing, serialization, and size failures", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const malformedPath = join(root, "malformed.json");
      const oversizedPath = join(root, "oversized.json");
      yield* Effect.promise(() => fs.writeFile(malformedPath, "{"));
      yield* Effect.promise(() =>
        fs.writeFile(oversizedPath, Buffer.alloc(JSON_FILE_MAX_BYTES + 1, 1)),
      );

      const jsonFile = makeJsonFile(yield* DesktopFileSystem);
      const parseError = yield* jsonFile.read(malformedPath).pipe(Effect.flip);
      expect(parseError.operation).toBe("parse");

      const serializationError = yield* jsonFile
        .write(join(root, "invalid.json"), undefined)
        .pipe(Effect.flip);
      expect(serializationError.operation).toBe("write");

      const sizeError = yield* jsonFile.read(oversizedPath).pipe(Effect.flip);
      expect(sizeError.operation).toBe("read");
      expect(sizeError.cause).toMatchObject({ reason: "TooLarge" });
    }),
  );

  it.effect("applies creation permissions to the published file", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(makeFixture);
      const path = join(root, "private.json");
      const jsonFile = makeJsonFile(yield* DesktopFileSystem);
      yield* jsonFile.write(path, { secret: true }, { mode: 0o600 });

      if (process.platform !== "win32") {
        const info = yield* Effect.promise(() => fs.stat(path));
        expect(info.mode & 0o777).toBe(0o600);
      }
    }),
  );
});
