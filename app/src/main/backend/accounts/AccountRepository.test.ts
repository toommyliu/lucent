import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { DesktopEnvironmentLive } from "../../app/DesktopEnvironment";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../../app/DesktopObservability";
import { DesktopStorageLive } from "../../storage/DesktopStorage";
import {
  AccountManagerRepository,
  layer,
  type AccountManagerRepositoryShape,
} from "./AccountRepository";
import {
  ACCOUNT_MANAGER_STORAGE_FILE,
  emptyAccountManagerStorage,
} from "./AccountStore";

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
  effect: (
    repository: AccountManagerRepositoryShape,
  ) => Effect.Effect<A, unknown>,
) =>
  Effect.gen(function* () {
    const repository = yield* AccountManagerRepository;
    return yield* effect(repository);
  }).pipe(Effect.provide(makeLayer(dir)));

describe("AccountManagerRepository", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "lucent-accounts-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it.effect(
    "returns defaults for missing storage without writing on read",
    () =>
      Effect.gen(function* () {
        expect(
          yield* runWithRepository(testDir, (repository) => repository.get),
        ).toEqual(emptyAccountManagerStorage());

        yield* Effect.promise(() =>
          expect(
            readFile(join(testDir, ACCOUNT_MANAGER_STORAGE_FILE), "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" }),
        );
      }),
  );

  it("returns a fresh default storage object for each empty store", () => {
    const first = emptyAccountManagerStorage();
    const second = emptyAccountManagerStorage();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.accounts).not.toBe(second.accounts);
  });

  it.effect("quarantines malformed app-data storage and writes defaults", () =>
    Effect.gen(function* () {
      const path = join(testDir, ACCOUNT_MANAGER_STORAGE_FILE);
      yield* Effect.promise(() => writeFile(path, "{ nope", "utf8"));

      expect(
        yield* runWithRepository(testDir, (repository) => repository.get),
      ).toEqual(emptyAccountManagerStorage());

      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${JSON.stringify(emptyAccountManagerStorage(), null, 2)}\n`,
      );
      const files = yield* Effect.promise(() => readdir(testDir));
      expect(
        files.some((file) =>
          file.startsWith(`${ACCOUNT_MANAGER_STORAGE_FILE}.corrupt-`),
        ),
      ).toBe(true);
    }),
  );

  it.effect(
    "serializes concurrent updates without losing account mutations",
    () =>
      Effect.gen(function* () {
        const path = join(testDir, ACCOUNT_MANAGER_STORAGE_FILE);
        const storage = yield* runWithRepository(testDir, (repository) =>
          Effect.gen(function* () {
            yield* Effect.all([
              repository.update((current) => ({
                ...current,
                accounts: [
                  ...current.accounts,
                  { label: "One", username: "one", password: "one-pass" },
                ],
              })),
              repository.update((current) => ({
                ...current,
                accounts: [
                  ...current.accounts,
                  { label: "Two", username: "two", password: "two-pass" },
                ],
              })),
            ]);
            return yield* repository.get;
          }),
        );

        expect(
          storage.accounts.map((account) => account.username).sort(),
        ).toEqual(["one", "two"]);
        expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
          `${JSON.stringify(storage, null, 2)}\n`,
        );
      }),
  );
});
