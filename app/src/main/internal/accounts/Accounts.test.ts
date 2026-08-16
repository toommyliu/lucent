import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  AccountGameSessionReport,
  AccountLaunchWindowTarget,
} from "@lucent/core/accounts";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { AccountGameWindows } from "./AccountGameWindows";
import * as AccountRepository from "./AccountRepository";
import { Accounts, layer as accountsLayer } from "./Accounts";
import { AccountsError } from "./AccountsError";
import { AccountServers } from "./AccountServers";
import * as AccountSessions from "./AccountSessions";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { force: true, recursive: true })),
  );
  tempDirs.clear();
});

interface HarnessOptions {
  readonly failClose?: boolean;
  readonly onClose?: (gameWindowId: number) => boolean;
  readonly onManagedProfileKey?: (key: string | undefined) => void;
  readonly onRetireProfile?: (key: string) => void;
  readonly onSetName?: (gameWindowId: number, name: string) => void;
  readonly onWindowTarget?: (
    windowTarget: AccountLaunchWindowTarget | undefined,
  ) => void;
}

class CloseRequestError extends Data.TaggedError("CloseRequestError")<{}> {}

const makeHarness = (harnessOptions: HarnessOptions = {}) =>
  Effect.gen(function* () {
    const appDataDir = yield* Effect.promise(() =>
      mkdtemp(join(tmpdir(), "lucent-accounts-data-")),
    );
    tempDirs.add(appDataDir);
    const env = DesktopEnvironment.of({
      appDataDir,
      assetsDir: join(appDataDir, "assets"),
      isDev: true,
      platform: "darwin",
      workspaceDir: join(appDataDir, "workspace"),
    });
    const closedListeners = new Set<
      (gameWindowId: number) => Effect.Effect<void, unknown>
    >();
    const createdListeners = new Set<
      (
        gameWindowId: number,
        rendererGeneration: number,
      ) => Effect.Effect<void, unknown>
    >();
    let nextWindowId = 1;
    const gameWindows = AccountGameWindows.of({
      close: (gameWindowId) =>
        Effect.gen(function* () {
          if (harnessOptions.failClose === true) {
            return yield* new CloseRequestError();
          }
          return harnessOptions.onClose?.(gameWindowId) ?? true;
        }),
      getGroupId: () => Effect.succeed(1),
      getRendererGeneration: () => Effect.succeed(1),
      onCreated: (listener) =>
        Effect.sync(() => {
          createdListeners.add(listener);
          return () => createdListeners.delete(listener);
        }),
      onClosed: (listener) =>
        Effect.sync(() => {
          closedListeners.add(listener);
          return () => closedListeners.delete(listener);
        }),
      onRendererReloaded: () => Effect.succeed(() => undefined),
      open: (openOptions) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            harnessOptions.onManagedProfileKey?.(
              openOptions?.managedProfileKey,
            );
            harnessOptions.onWindowTarget?.(openOptions?.windowTarget);
          });
          const gameWindowId = nextWindowId++;
          yield* Effect.forEach(
            [...createdListeners],
            (listener) => listener(gameWindowId, 1),
            { discard: true },
          );
          if (openOptions?.onCreated !== undefined) {
            yield* openOptions.onCreated(gameWindowId);
          }
          return gameWindowId;
        }),
      reveal: () => Effect.succeed(true),
      retireProfile: (key) =>
        Effect.sync(() => harnessOptions.onRetireProfile?.(key)),
      setName: (gameWindowId, name) =>
        Effect.sync(() => harnessOptions.onSetName?.(gameWindowId, name)),
    });
    const servers = AccountServers.of({
      get: Effect.succeed({ refreshAvailableAt: 0, servers: [] }),
      getPings: Effect.succeed({ expiresAt: 0, measuredAt: 0, pings: [] }),
      refresh: Effect.succeed({ refreshAvailableAt: 0, servers: [] }),
    });
    const dependencies = Layer.mergeAll(
      AccountRepository.layer.pipe(
        Layer.provide(Layer.succeed(DesktopEnvironment, env)),
      ),
      AccountSessions.layer,
      Layer.succeed(AccountGameWindows, gameWindows),
      Layer.succeed(AccountServers, servers),
    );

    return accountsLayer.pipe(Layer.provide(dependencies));
  });

describe("Accounts", () => {
  it.effect("persists account and group mutations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const layer = yield* makeHarness();
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.createAccount({
          username: "Alice",
          password: "secret",
        });
        const state = yield* accounts.createGroup({
          name: "Party",
          usernames: ["Alice"],
        });

        expect(state.accounts).toEqual([
          { label: "Alice", password: "secret", username: "Alice" },
        ]);
        expect(state.groups).toEqual({ Party: ["Alice"] });

        const error = yield* Effect.flip(
          accounts.createAccount({
            username: "alice",
            password: "other",
          }),
        );
        expect(error).toBeInstanceOf(AccountsError);
      }),
    ),
  );

  it.effect("deletes multiple accounts and group memberships atomically", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const retiredProfiles: string[] = [];
        const layer = yield* makeHarness({
          onRetireProfile: (key) => retiredProfiles.push(key),
        });
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        for (const username of ["Alice", "Bob", "Cara"]) {
          yield* accounts.createAccount({ password: "secret", username });
        }
        yield* accounts.createGroup({
          name: "Party",
          usernames: ["Alice", "Bob", "Cara"],
        });

        yield* Effect.flip(accounts.deleteAccounts(["Alice", "Missing"]));
        expect((yield* accounts.getState).accounts).toHaveLength(3);
        expect(retiredProfiles).toEqual([]);

        const state = yield* accounts.deleteAccounts(["Alice", "Bob"]);

        expect(state.accounts.map((account) => account.username)).toEqual([
          "Cara",
        ]);
        expect(state.groups).toEqual({ Party: ["Cara"] });
        expect(retiredProfiles).toEqual(["Alice", "Bob"]);
      }),
    ),
  );

  it.effect("retires the old profile after an account username changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const retiredProfiles: string[] = [];
        const layer = yield* makeHarness({
          onRetireProfile: (key) => retiredProfiles.push(key),
        });
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.createAccount({
          username: "Alice",
          password: "secret",
        });

        yield* accounts.updateAccount("Alice", { username: "Alicia" });
        yield* accounts.updateAccount("Alicia", { username: "ALICIA" });

        expect(retiredProfiles).toEqual(["Alice"]);
      }),
    ),
  );

  it.effect("tracks launch intent and accepts full renderer reports", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const managedProfileKeys: Array<string | undefined> = [];
        const windowTargets: Array<AccountLaunchWindowTarget | undefined> = [];
        const layer = yield* makeHarness({
          onManagedProfileKey: (key) => managedProfileKeys.push(key),
          onClose: () => false,
          onWindowTarget: (windowTarget) => windowTargets.push(windowTarget),
        });
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.createAccount({
          username: "Alice",
          password: "secret",
        });
        const launch = yield* accounts.launch({
          username: "Alice",
          script: { name: "farm.js", path: "/scripts/farm.js" },
          windowTarget: { kind: "new" },
        });
        const payload = yield* accounts.getGameLaunch(launch.gameWindowId);
        expect(payload?.account.username).toBe("Alice");
        expect(payload?.script).toEqual({
          name: "farm.js",
          path: "/scripts/farm.js",
        });
        expect(managedProfileKeys).toEqual(["Alice"]);
        expect(windowTargets).toEqual([{ kind: "new" }]);

        const report: AccountGameSessionReport = {
          connection: { state: "online", username: "Alice" },
          login: { state: "idle" },
          rendererGeneration: 1,
          revision: 1,
          script: { name: "farm.js", state: "running" },
        };
        yield* accounts.reportSession(launch.gameWindowId, report);
        expect((yield* accounts.getState).sessions[0]).toMatchObject({
          connection: { state: "online", username: "Alice" },
          gameWindowGroupId: 1,
          gameWindowId: launch.gameWindowId,
          revision: 1,
          script: { state: "running" },
        });

        const closed = yield* accounts.closeGameWindow(launch.gameWindowId);
        expect(closed.sessions).toEqual([]);
        expect(yield* accounts.getGameLaunch(launch.gameWindowId)).toBeNull();
      }),
    ),
  );

  it.effect("preserves a session when a close request fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const layer = yield* makeHarness({
          failClose: true,
        });
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.createAccount({
          username: "Alice",
          password: "secret",
        });
        const launch = yield* accounts.launch({ username: "Alice" });

        const error = yield* Effect.flip(
          accounts.closeGameWindow(launch.gameWindowId),
        );
        expect(error).toBeInstanceOf(AccountsError);
        expect((yield* accounts.getState).sessions).toHaveLength(1);
      }),
    ),
  );

  it.effect("does not claim an online session when no server is selected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const layer = yield* makeHarness();
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.createAccount({
          username: "Alice",
          password: "secret",
        });
        const launch = yield* accounts.launch({ username: "Alice" });
        const report: AccountGameSessionReport = {
          connection: { state: "offline" },
          login: { state: "select-server" },
          rendererGeneration: 1,
          revision: 1,
          script: { state: "idle" },
        };
        yield* accounts.reportSession(launch.gameWindowId, report);
        expect((yield* accounts.getState).sessions[0]).toMatchObject({
          connection: { state: "offline" },
          gameWindowId: launch.gameWindowId,
          login: { state: "select-server" },
        });
      }),
    ),
  );

  it.effect("does not create a session from an unregistered report", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const layer = yield* makeHarness();
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.reportSession(42, {
          connection: { state: "offline" },
          login: { state: "select-server" },
          rendererGeneration: 1,
          revision: 1,
          script: { state: "idle" },
        });

        expect((yield* accounts.getState).sessions).toEqual([]);
      }),
    ),
  );

  it.effect(
    "ignores stale reports after logout and keeps online naming authoritative",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const names: Array<{ readonly id: number; readonly name: string }> =
            [];
          const layer = yield* makeHarness({
            onSetName: (id, name) => names.push({ id, name }),
          });
          const accounts = yield* Accounts.pipe(Effect.provide(layer));
          yield* accounts.createAccount({
            username: "Alice",
            password: "secret",
          });
          const launch = yield* accounts.launch({ username: "Alice" });
          const online: AccountGameSessionReport = {
            connection: { state: "online", username: "DirectPlayer" },
            login: { state: "idle" },
            rendererGeneration: 1,
            revision: 1,
            script: { state: "idle" },
          };
          yield* accounts.reportSession(launch.gameWindowId, online);
          yield* accounts.reportSession(launch.gameWindowId, {
            ...online,
            connection: { state: "offline", lastUsername: "DirectPlayer" },
            revision: 2,
          });
          yield* accounts.reportSession(launch.gameWindowId, online);

          const [session] = (yield* accounts.getState).sessions;
          expect(session?.connection).toEqual({
            lastUsername: "DirectPlayer",
            state: "offline",
          });
          expect(names).toEqual([
            { id: launch.gameWindowId, name: "DirectPlayer" },
          ]);
        }),
      ),
  );
});
