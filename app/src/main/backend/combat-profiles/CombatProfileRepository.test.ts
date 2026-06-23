import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { DEFAULT_COMBAT_PROFILE_LIBRARY } from "../../../shared/combat-profiles";
import { DesktopEnvironmentLive } from "../../app/DesktopEnvironment";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../../app/DesktopObservability";
import { DesktopStorageLive } from "../../storage/DesktopStorage";
import {
  CombatProfileRepository,
  layer,
  type CombatProfileRepositoryShape,
} from "./CombatProfileRepository";

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

const fileName = "combat-profiles.json";

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
  effect: (
    repository: CombatProfileRepositoryShape,
  ) => Effect.Effect<A, unknown>,
) =>
  Effect.gen(function* () {
    const repository = yield* CombatProfileRepository;
    return yield* effect(repository);
  }).pipe(Effect.provide(makeLayer(dir)));

describe("CombatProfileRepository", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "lucent-combat-profiles-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it.effect(
    "returns defaults for missing storage without writing on read",
    () =>
      Effect.gen(function* () {
        const library = yield* runWithRepository(
          testDir,
          (repository) => repository.get,
        );

        expect(library).toEqual(DEFAULT_COMBAT_PROFILE_LIBRARY);
        expect(library).not.toBe(DEFAULT_COMBAT_PROFILE_LIBRARY);
        expect(library.profiles).not.toBe(
          DEFAULT_COMBAT_PROFILE_LIBRARY.profiles,
        );

        yield* Effect.promise(() =>
          expect(
            readFile(join(testDir, fileName), "utf8"),
          ).rejects.toMatchObject({
            code: "ENOENT",
          }),
        );
      }),
  );

  it.effect("quarantines malformed app-data storage and writes defaults", () =>
    Effect.gen(function* () {
      const path = join(testDir, fileName);
      yield* Effect.promise(() => writeFile(path, "{ nope", "utf8"));

      expect(
        yield* runWithRepository(testDir, (repository) => repository.get),
      ).toEqual(DEFAULT_COMBAT_PROFILE_LIBRARY);

      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${JSON.stringify(DEFAULT_COMBAT_PROFILE_LIBRARY, null, 2)}\n`,
      );
      const files = yield* Effect.promise(() => readdir(testDir));
      expect(
        files.some((file) => file.startsWith(`${fileName}.corrupt-`)),
      ).toBe(true);
    }),
  );

  it.effect("serializes concurrent updates without losing profiles", () =>
    Effect.gen(function* () {
      const path = join(testDir, fileName);
      const baseProfile = DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]!;
      const library = yield* runWithRepository(testDir, (repository) =>
        Effect.gen(function* () {
          yield* Effect.all([
            repository.update((current) => ({
              ...current,
              profiles: [
                ...current.profiles,
                { ...baseProfile, id: "one", label: "One" },
              ],
            })),
            repository.update((current) => ({
              ...current,
              profiles: [
                ...current.profiles,
                { ...baseProfile, id: "two", label: "Two" },
              ],
            })),
          ]);
          return yield* repository.get;
        }),
      );

      expect(library.profiles.map((profile) => profile.id).sort()).toEqual([
        "generic-base",
        "one",
        "two",
      ]);
      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${JSON.stringify(library, null, 2)}\n`,
      );
    }),
  );
});
