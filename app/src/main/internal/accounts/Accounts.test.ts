import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";
import { Effect, Layer } from "effect";

import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../../app/DesktopEnvironment";
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

const makeHarness = () =>
  Effect.gen(function* () {
    const appDataDir = yield* Effect.promise(() =>
      mkdtemp(join(tmpdir(), "lucent-accounts-data-")),
    );
    tempDirs.add(appDataDir);
    const env = makeDesktopEnvironment({
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
      onClosed: (listener) =>
        Effect.sync(() => {
          closedListeners.add(listener);
          return () => closedListeners.delete(listener);
        }),
      open: (options) =>
        Effect.gen(function* () {
          const gameWindowId = nextWindowId++;
          if (options?.onCreated !== undefined) {
            yield* options.onCreated(gameWindowId);
          }
          return gameWindowId;
        }),
      reveal: () => Effect.succeed(true),
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

  it.effect("tracks launch and script sessions independently of windows", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const layer = yield* makeHarness();
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

        yield* accounts.updateScriptStatus(launch.gameWindowId, {
          status: "running",
          scriptName: "farm.js",
        });
        expect((yield* accounts.getState).sessions[0]).toMatchObject({
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
});
