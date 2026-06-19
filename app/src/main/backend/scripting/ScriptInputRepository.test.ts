import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { resolveScriptInputValues } from "../../../shared/script-inputs";
import { makeDesktopStorage } from "../../storage/DesktopStorage";
import {
  makeScriptInputRepository,
  scriptInputStorageFileName,
} from "./ScriptInputRepository";

const definition = {
  id: "author.script",
  fields: [
    { key: "target", type: "string", required: true },
    { key: "count", type: "number", defaultValue: 3 },
  ],
} as const;

const observability = {
  debug: () =>
    Effect.succeed({
      id: 0,
      runId: "test",
      timestamp: "2026-06-18T00:00:00.000Z",
      level: "debug" as const,
      source: "main" as const,
      component: "test",
      message: "test",
    }),
  warn: () =>
    Effect.succeed({
      id: 0,
      runId: "test",
      timestamp: "2026-06-18T00:00:00.000Z",
      level: "warn" as const,
      source: "main" as const,
      component: "test",
      message: "test",
    }),
};

describe("ScriptInputRepository", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "lucent-script-inputs-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const makeRepository = () => {
    const storage = makeDesktopStorage();
    return {
      repository: makeScriptInputRepository({
        inputsDir: testDir,
        storage,
        observability,
        now: () => new Date("2026-06-18T00:00:00.000Z"),
      }),
      storage,
    };
  };

  const storagePath = () =>
    join(testDir, scriptInputStorageFileName(definition.id));

  it.effect("returns defaults for missing storage without writing", () =>
    Effect.gen(function* () {
      const { repository } = makeRepository();

      expect(yield* repository.get(definition)).toEqual({});
      expect(yield* Effect.promise(() => readdir(testDir))).toEqual([]);
    }),
  );

  it.effect("quarantines malformed per-script storage", () =>
    Effect.gen(function* () {
      const { repository } = makeRepository();
      const path = storagePath();
      yield* Effect.promise(() => writeFile(path, "{ nope", "utf8"));

      expect(yield* repository.get(definition)).toEqual({});

      const files = yield* Effect.promise(() => readdir(testDir));
      expect(
        files.some((file) =>
          file.startsWith(
            `${scriptInputStorageFileName(definition.id)}.corrupt-`,
          ),
        ),
      ).toBe(true);
    }),
  );

  it.effect("preserves unknown saved keys while updating declared values", () =>
    Effect.gen(function* () {
      const { repository, storage } = makeRepository();
      const path = storagePath();
      yield* storage.writeJson(path, {
        version: 1,
        id: definition.id,
        values: {
          target: "old",
          stale: "keep",
        },
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      expect(
        yield* repository.set(definition, { target: "wolf", count: 7 }),
      ).toEqual({
        stale: "keep",
        target: "wolf",
        count: 7,
      });

      const file = yield* storage.readJson(path);
      expect(file).toMatchObject({
        status: "ok",
        value: {
          values: {
            stale: "keep",
            target: "wolf",
            count: 7,
          },
        },
      });
    }),
  );

  it.effect(
    "leaves invalid saved values for strict declaration resolution",
    () =>
      Effect.gen(function* () {
        const { repository, storage } = makeRepository();
        yield* storage.writeJson(storagePath(), {
          version: 1,
          id: definition.id,
          values: {
            target: 123,
            count: "bad",
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
        });

        const savedValues = yield* repository.get(definition);
        expect(resolveScriptInputValues(definition, savedValues)).toEqual({
          values: { count: 3 },
          missingRequiredKeys: ["target"],
        });
      }),
  );
});
