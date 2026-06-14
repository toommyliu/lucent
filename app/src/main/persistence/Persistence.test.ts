import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import {
  PersistenceError,
  makePersistence,
  parseYamlSource,
} from "./Persistence";

interface TestSettings {
  readonly enabled: boolean;
  readonly count: number;
}

describe("persistence", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "lucent-persistence-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it.effect("distinguishes missing and malformed JSON", () =>
    Effect.gen(function* () {
      const persistence = makePersistence();
      const path = join(testDir, "settings.json");

      expect(yield* persistence.readJson(path)).toEqual({
        status: "missing",
      });

      yield* Effect.promise(() => writeFile(path, "{ nope", "utf8"));

      expect(yield* persistence.readJson(path)).toMatchObject({
        status: "malformed",
        error: { path, format: "json" },
      });
    }),
  );

  it.effect("does not write while reading existing JSON", () =>
    Effect.gen(function* () {
      const persistence = makePersistence();
      const path = join(testDir, "settings.json");
      const source = '{"enabled":false,"extra":true}\n';
      yield* Effect.promise(() => writeFile(path, source, "utf8"));

      expect(yield* persistence.readJson(path)).toMatchObject({
        status: "ok",
        value: { enabled: false, extra: true },
      });
      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(source);
    }),
  );

  it.effect("writes JSON atomically with parent directory creation", () =>
    Effect.gen(function* () {
      const persistence = makePersistence();
      const path = join(testDir, "nested", "settings.json");

      yield* persistence.writeJson(path, {
        enabled: false,
        count: 3,
      } satisfies TestSettings);

      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${JSON.stringify({ enabled: false, count: 3 }, null, 2)}\n`,
      );
      expect(
        yield* Effect.promise(() => readdir(join(testDir, "nested"))),
      ).toEqual(["settings.json"]);
    }),
  );

  it("rejects YAML aliases and explicit tags", () => {
    expect(() =>
      parseYamlSource("enabled: &enabled false\ncount: *enabled\n"),
    ).toThrow("YAML aliases are not supported");

    expect(() => parseYamlSource("enabled: false\ncount: !custom 1\n")).toThrow(
      "YAML tags are not supported",
    );
  });

  it.effect("returns malformed for unsafe workspace YAML", () =>
    Effect.gen(function* () {
      const persistence = makePersistence();
      const path = join(testDir, "army.yaml");
      yield* Effect.promise(() =>
        writeFile(path, "enabled: &enabled false\ncount: *enabled\n", "utf8"),
      );

      expect(yield* persistence.readYaml(path)).toMatchObject({
        status: "malformed",
        error: { path, format: "yaml" },
      });
    }),
  );

  it.effect("writes YAML with a trailing newline", () =>
    Effect.gen(function* () {
      const persistence = makePersistence();
      const path = join(testDir, "nested", "settings.yaml");

      yield* persistence.writeYaml(path, { enabled: false, count: 3 });

      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        "enabled: false\ncount: 3\n",
      );
    }),
  );

  it.effect("cleans temp files when serialization fails", () =>
    Effect.gen(function* () {
      const persistence = makePersistence();
      const path = join(testDir, "settings.yaml");
      const circular: Record<string, unknown> = {};
      circular["self"] = circular;

      const error = yield* Effect.flip(persistence.writeYaml(path, circular));
      expect(error).toBeInstanceOf(PersistenceError);
      expect(yield* Effect.promise(() => readdir(testDir))).toEqual([]);
    }),
  );

  it.effect(
    "keeps JSON serialization failures in the persistence error channel",
    () =>
      Effect.gen(function* () {
        const persistence = makePersistence();
        const path = join(testDir, "settings.json");
        const circular: Record<string, unknown> = {};
        circular["self"] = circular;

        const error = yield* Effect.flip(persistence.writeJson(path, circular));
        expect(error).toBeInstanceOf(PersistenceError);
        expect(yield* Effect.promise(() => readdir(testDir))).toEqual([]);
      }),
  );

  it.effect(
    "quarantines malformed files before defaults are written by repositories",
    () =>
      Effect.gen(function* () {
        const persistence = makePersistence();
        const path = join(testDir, "settings.json");
        yield* Effect.promise(() => writeFile(path, "{ nope", "utf8"));
        const result = yield* persistence.readJson(path);
        expect(result.status).toBe("malformed");

        const quarantinePath = yield* persistence.quarantineMalformed(
          path,
          "invalid json",
        );

        expect(quarantinePath).not.toBeNull();
        expect(
          yield* Effect.promise(() => readFile(quarantinePath!, "utf8")),
        ).toBe("{ nope");
        expect(yield* persistence.readJson(path)).toEqual({
          status: "missing",
        });
      }),
  );
});
