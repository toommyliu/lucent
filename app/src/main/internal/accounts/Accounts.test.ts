import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
  readonly onManagedProfileKey?: (key: string | undefined) => void;
  readonly onRetireProfile?: (key: string) => void;
  readonly onSetName?: (gameWindowId: number, name: string) => void;
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
    let nextWindowId = 1;
    const gameWindows = AccountGameWindows.of({
      close: (gameWindowId) =>
        Effect.forEach(
          [...closedListeners],
          (listener) => listener(gameWindowId),
          { discard: true },
        ).pipe(Effect.as(true)),
      getGroupId: () => Effect.succeed(1),
      onClosed: (listener) =>
        Effect.sync(() => {
          closedListeners.add(listener);
          return () => closedListeners.delete(listener);
        }),
      open: (openOptions) =>
        Effect.gen(function* () {
          yield* Effect.sync(() =>
            harnessOptions.onManagedProfileKey?.(
              openOptions?.managedProfileKey,
            ),
          );
          const gameWindowId = nextWindowId++;
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

  it.effect("tracks launch and script sessions independently of windows", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const managedProfileKeys: Array<string | undefined> = [];
        const layer = yield* makeHarness({
          onManagedProfileKey: (key) => managedProfileKeys.push(key),
        });
        const accounts = yield* Accounts.pipe(Effect.provide(layer));
        yield* accounts.createAccount({
          username: "Alice",
          password: "secret",
        });
        const launch = yield* accounts.launch({
          username: "Alice",
          script: { name: "farm.js", path: "/scripts/farm.js" },
        });
        const payload = yield* accounts.getGameLaunch(launch.gameWindowId);
        expect(payload?.account.username).toBe("Alice");
        expect(payload?.script).toEqual({
          name: "farm.js",
          path: "/scripts/farm.js",
        });
        expect(managedProfileKeys).toEqual(["Alice"]);

        yield* accounts.updateScriptStatus(launch.gameWindowId, {
          status: "running",
          scriptName: "farm.js",
        });
        expect((yield* accounts.getState).sessions[0]).toMatchObject({
          gameWindowGroupId: 1,
          gameWindowId: launch.gameWindowId,
          scriptName: "farm.js",
          status: "running",
        });

        const closed = yield* accounts.closeGameWindow(launch.gameWindowId);
        expect(closed.sessions).toEqual([]);
        expect(yield* accounts.getGameLaunch(launch.gameWindowId)).toBeNull();
      }),
    ),
  );

  it.effect(
    "tracks authenticated usernames for directly opened game windows",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const layer = yield* makeHarness();
          const accounts = yield* Accounts.pipe(Effect.provide(layer));

          yield* accounts.updateScriptStatus(42, {
            currentUsername: "DirectPlayer",
            message: "Logged in",
            status: "stopped",
          });

          expect((yield* accounts.getState).sessions).toEqual([
            expect.objectContaining({
              currentUsername: "DirectPlayer",
              gameWindowId: 42,
              status: "stopped",
            }),
          ]);
        }),
      ),
  );

  it.effect("clears logged-out session usernames and game view names", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const names: Array<{ readonly id: number; readonly name: string }> = [];
        const layer = yield* makeHarness({
          onSetName: (id, name) => names.push({ id, name }),
        });
        const accounts = yield* Accounts.pipe(Effect.provide(layer));

        yield* accounts.updateScriptStatus(42, {
          currentUsername: "DirectPlayer",
          message: "Logged in",
          status: "stopped",
        });
        yield* accounts.updateScriptStatus(42, {
          currentUsername: null,
          message: "Logged out",
          status: "stopped",
        });
        yield* accounts.updateScriptStatus(42, {
          message: "Stopped",
          status: "stopped",
        });

        const [session] = (yield* accounts.getState).sessions;
        expect(session).not.toHaveProperty("currentUsername");
        expect(session).toMatchObject({
          authenticated: false,
          gameWindowId: 42,
          message: "Stopped",
          status: "stopped",
        });
        expect(names).toEqual([
          { id: 42, name: "DirectPlayer" },
          { id: 42, name: "" },
        ]);
      }),
    ),
  );
});
