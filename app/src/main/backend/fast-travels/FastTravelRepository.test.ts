import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { DEFAULT_FAST_TRAVELS } from "../../../shared/fast-travels";
import { DesktopEnvironmentLive } from "../../app/DesktopEnvironment";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../../app/DesktopObservability";
import { DesktopStorageLive } from "../../storage/DesktopStorage";
import {
  FAST_TRAVELS_STORAGE_FILE,
  FastTravelRepository,
  layer,
  type FastTravelRepositoryShape,
} from "./FastTravelRepository";

const observability: DesktopObservabilityShape = {
  runId: "test",
  logPath: "/tmp/lucent-test.ndjson",
  write: () =>
    Effect.succeed({
      id: 0,
      runId: "test",
      timestamp: "2026-05-22T00:00:00.000Z",
      level: "info",
      source: "main",
      component: "test",
      message: "test",
    }),
  debug: () =>
    Effect.succeed({
      id: 0,
      runId: "test",
      timestamp: "2026-05-22T00:00:00.000Z",
      level: "debug",
      source: "main",
      component: "test",
      message: "test",
    }),
  info: () =>
    Effect.succeed({
      id: 0,
      runId: "test",
      timestamp: "2026-05-22T00:00:00.000Z",
      level: "info",
      source: "main",
      component: "test",
      message: "test",
    }),
  warn: () =>
    Effect.succeed({
      id: 0,
      runId: "test",
      timestamp: "2026-05-22T00:00:00.000Z",
      level: "warn",
      source: "main",
      component: "test",
      message: "test",
    }),
  error: () =>
    Effect.succeed({
      id: 0,
      runId: "test",
      timestamp: "2026-05-22T00:00:00.000Z",
      level: "error",
      source: "main",
      component: "test",
      message: "test",
    }),
  snapshot: Effect.succeed({
    runId: "test",
    logPath: "/tmp/lucent-test.ndjson",
    records: [],
  }),
  subscribe: () => Effect.succeed(() => undefined),
  installProcessHooks: Effect.void,
  observeWindow: () => Effect.void,
};

const makeLayer = (dir: string) =>
  layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        DesktopEnvironmentLive({
          appDataDir: dir,
          workspaceDir: join(dir, "workspace"),
          assetsDir: join(dir, "assets"),
          rendererDir: join(dir, "renderer"),
          preloadPath: join(dir, "preload.js"),
          isDev: false,
          isDarwin: true,
          isWin: false,
          isLinux: false,
        }),
        DesktopStorageLive,
        Layer.succeed(DesktopObservability)(observability),
      ),
    ),
  );

const runWithRepository = <A>(
  dir: string,
  effect: (repository: FastTravelRepositoryShape) => Effect.Effect<A, unknown>,
) =>
  Effect.gen(function* () {
    const repository = yield* FastTravelRepository;
    return yield* effect(repository);
  }).pipe(Effect.provide(makeLayer(dir)));

describe("FastTravelRepository", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "lucent-fast-travels-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it.effect(
    "returns defaults for missing storage without writing on read",
    () =>
      Effect.gen(function* () {
        const locations = yield* runWithRepository(
          testDir,
          (repository) => repository.get,
        );

        expect(locations).toEqual(DEFAULT_FAST_TRAVELS);
        expect(locations).not.toBe(DEFAULT_FAST_TRAVELS);

        yield* Effect.promise(() =>
          expect(
            readFile(join(testDir, FAST_TRAVELS_STORAGE_FILE), "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" }),
        );
      }),
  );

  it.effect("quarantines malformed storage and writes defaults", () =>
    Effect.gen(function* () {
      const path = join(testDir, FAST_TRAVELS_STORAGE_FILE);
      yield* Effect.promise(() => writeFile(path, "{ nope", "utf8"));

      expect(
        yield* runWithRepository(testDir, (repository) => repository.get),
      ).toEqual(DEFAULT_FAST_TRAVELS);

      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${JSON.stringify(DEFAULT_FAST_TRAVELS, null, 2)}\n`,
      );
      const files = yield* Effect.promise(() => readdir(testDir));
      expect(
        files.some((file) =>
          file.startsWith(`${FAST_TRAVELS_STORAGE_FILE}.corrupt-`),
        ),
      ).toBe(true);
    }),
  );

  it.effect("normalizes and persists updates", () =>
    Effect.gen(function* () {
      const path = join(testDir, FAST_TRAVELS_STORAGE_FILE);
      const locations = yield* runWithRepository(testDir, (repository) =>
        repository.update(() => [
          { name: " Home ", map: "Battleon" },
          { name: "home", map: "ignored" },
          { name: "Boss", map: "Escherion", cell: " Boss " },
        ]),
      );

      expect(locations).toEqual([
        { name: "Home", map: "battleon" },
        { name: "Boss", map: "escherion", cell: "Boss" },
      ]);
      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${JSON.stringify(locations, null, 2)}\n`,
      );
    }),
  );

  it.effect("serializes concurrent updates without losing locations", () =>
    Effect.gen(function* () {
      const path = join(testDir, FAST_TRAVELS_STORAGE_FILE);
      const locations = yield* runWithRepository(testDir, (repository) =>
        Effect.gen(function* () {
          yield* repository.set([]);
          yield* Effect.all([
            repository.update((current) => [
              ...current,
              { name: "One", map: "battleon" },
            ]),
            repository.update((current) => [
              ...current,
              { name: "Two", map: "yulgar" },
            ]),
          ]);
          return yield* repository.get;
        }),
      );

      expect(locations.map((location) => location.name).sort()).toEqual([
        "One",
        "Two",
      ]);
      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${JSON.stringify(locations, null, 2)}\n`,
      );
    }),
  );
});
