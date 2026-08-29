import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { AccountLaunchWindowTarget } from "@lucent/core/accounts";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { layer as desktopFileSystemLayer } from "../../filesystem/DesktopFileSystemNode";
import {
  AccountGameWindows,
  type AccountGameWindowEvent,
} from "./AccountGameWindows";
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
  readonly onManagedProfileKey?: (key: string | undefined) => void;
  readonly onRetireProfile?: (key: string) => void;
  readonly onSetName?: (gameWindowId: number, name: string) => void;
  readonly onWindowTarget?: (
    windowTarget: AccountLaunchWindowTarget | undefined,
  ) => void;
}

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
      (event: AccountGameWindowEvent) => Effect.Effect<void, unknown>
    >();
    const reloadedListeners = new Set<
      (event: AccountGameWindowEvent) => Effect.Effect<void, unknown>
    >();
    let nextWindowId = 1;
    const gameWindows = AccountGameWindows.of({
      close: (gameWindowId) =>
        Effect.forEach(
          [...closedListeners],
          (listener) => listener(gameWindowId),
          { discard: true },
        ).pipe(Effect.as(true)),
      getGeneration: () => Effect.succeed(1),
      getGroupId: () => Effect.succeed(1),
      onClosed: (listener) =>
        Effect.sync(() => {
          closedListeners.add(listener);
          return () => closedListeners.delete(listener);
        }),
      onCreated: (listener) =>
        Effect.sync(() => {
          createdListeners.add(listener);
          return () => createdListeners.delete(listener);
        }),
      onReloaded: (listener) =>
        Effect.sync(() => {
          reloadedListeners.add(listener);
          return () => reloadedListeners.delete(listener);
        }),
      open: (openOptions) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            harnessOptions.onManagedProfileKey?.(
              openOptions?.managedProfileKey,
            );
            harnessOptions.onWindowTarget?.(openOptions?.windowTarget);
          });
          const gameWindowId = nextWindowId++;
          const event = {
            gameWindowGroupId: 1,
            gameWindowId,
            rendererGeneration: 1,
          };
          yield* Effect.forEach(
            [...createdListeners],
            (listener) => listener(event),
            { discard: true },
          );
          if (openOptions?.onCreated !== undefined) {
            yield* openOptions.onCreated(event);
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
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(DesktopEnvironment, env),
            desktopFileSystemLayer,
          ),
        ),
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

  it.effect("tracks launch intent separately from reported runtime", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const managedProfileKeys: Array<string | undefined> = [];
        const windowTargets: Array<AccountLaunchWindowTarget | undefined> = [];
        const layer = yield* makeHarness({
          onManagedProfileKey: (key) => managedProfileKeys.push(key),
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

        yield* accounts.reportSession(launch.gameWindowId, {
          rendererGeneration: 1,
          revision: 1,
          runtime: {
            connection: { state: "online", username: "Alice" },
            login: { state: "idle" },
            script: { name: "farm.js", state: "running" },
          },
        });
        expect((yield* accounts.getState).sessions[0]).toMatchObject({
          connection: { state: "online", username: "Alice" },
          gameWindowGroupId: 1,
          gameWindowId: launch.gameWindowId,
          script: { name: "farm.js", state: "running" },
        });

        const closed = yield* accounts.closeGameWindow(launch.gameWindowId);
        expect(closed.sessions).toEqual([]);
        expect(yield* accounts.getGameLaunch(launch.gameWindowId)).toBeNull();
      }),
    ),
  );

  it.effect("does not create a session from an untracked renderer report", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const layer = yield* makeHarness();
        const accounts = yield* Accounts.pipe(Effect.provide(layer));

        yield* accounts.reportSession(42, {
          rendererGeneration: 1,
          revision: 1,
          runtime: {
            connection: { state: "online", username: "DirectPlayer" },
            login: { state: "idle" },
            script: { state: "idle" },
          },
        });

        expect((yield* accounts.getState).sessions).toEqual([]);
      }),
    ),
  );

  it.effect("clears identity on logout and ignores an older report", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const names: Array<{ readonly id: number; readonly name: string }> = [];
        const layer = yield* makeHarness({
          onSetName: (id, name) => names.push({ id, name }),
        });
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.createAccount({
          password: "secret",
          username: "Alice",
        });
        const launch = yield* accounts.launch({ username: "Alice" });

        yield* accounts.reportSession(launch.gameWindowId, {
          rendererGeneration: 1,
          revision: 1,
          runtime: {
            connection: { state: "online", username: "DirectPlayer" },
            login: { state: "idle" },
            script: { state: "idle" },
          },
        });
        yield* accounts.reportSession(launch.gameWindowId, {
          rendererGeneration: 1,
          revision: 2,
          runtime: {
            connection: {
              lastUsername: "DirectPlayer",
              state: "offline",
            },
            login: { state: "idle" },
            script: { message: "Stopped", state: "stopped" },
          },
        });
        yield* accounts.reportSession(launch.gameWindowId, {
          rendererGeneration: 1,
          revision: 1,
          runtime: {
            connection: { state: "online", username: "StalePlayer" },
            login: { state: "idle" },
            script: { state: "idle" },
          },
        });

        const [session] = (yield* accounts.getState).sessions;
        expect(session).toMatchObject({
          connection: {
            lastUsername: "DirectPlayer",
            state: "offline",
          },
          gameWindowId: launch.gameWindowId,
          script: { message: "Stopped", state: "stopped" },
        });
        expect(names).toEqual([
          { id: launch.gameWindowId, name: "DirectPlayer" },
          { id: launch.gameWindowId, name: "" },
        ]);
      }),
    ),
  );
});
