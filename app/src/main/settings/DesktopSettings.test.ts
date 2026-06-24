import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";
import { Effect, Layer } from "effect";

import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../app/DesktopEnvironment";
import {
  DesktopSettings,
  DesktopSettingsError,
  layer as desktopSettingsLayer,
} from "./DesktopSettings";

const tempDirs = new Set<string>();

const makeTempDir = async (prefix: string): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { force: true, recursive: true })),
  );
  tempDirs.clear();
});

describe("DesktopSettings", () => {
  it.effect("persists appearance updates and emits one change after save", () =>
    Effect.gen(function* () {
      const appDataDir = yield* Effect.promise(() =>
        makeTempDir("lucent-settings-data-"),
      );
      const workspaceDir = yield* Effect.promise(() =>
        makeTempDir("lucent-settings-workspace-"),
      );
      const env = makeDesktopEnvironment({
        appDataDir,
        assetsDir: join(appDataDir, "assets"),
        isDev: true,
        platform: "darwin",
        rendererDir: join(appDataDir, "renderer"),
        workspaceDir,
      });
      const settingsLayer = desktopSettingsLayer.pipe(
        Layer.provide(Layer.succeed(DesktopEnvironment, env)),
      );
      const settings = yield* DesktopSettings.pipe(
        Effect.provide(settingsLayer),
      );

      yield* settings.load;
      let emitted = 0;
      let lastThemeMode: string | null = null;
      const unsubscribe = yield* settings.onChanged((nextSettings) => {
        emitted += 1;
        lastThemeMode = nextSettings.appearance.themeMode;
      });

      const updated = yield* settings.updateAppearance({ themeMode: "light" });
      unsubscribe();
      const persisted = JSON.parse(
        yield* Effect.promise(() => readFile(env.settingsPath, "utf8")),
      ) as {
        readonly appearance?: { readonly themeMode?: string };
        readonly hotkeys?: { readonly bindings?: readonly unknown[] };
      };

      expect(updated.appearance.themeMode).toBe("light");
      expect(persisted.appearance?.themeMode).toBe("light");
      expect(persisted.hotkeys?.bindings?.length).toBe(
        DEFAULT_APP_SETTINGS.hotkeys.bindings.length,
      );
      expect(emitted).toBe(1);
      expect(lastThemeMode).toBe("light");
    }),
  );

  it.effect("rejects duplicate hotkey bindings before saving", () =>
    Effect.gen(function* () {
      const appDataDir = yield* Effect.promise(() =>
        makeTempDir("lucent-settings-data-"),
      );
      const workspaceDir = yield* Effect.promise(() =>
        makeTempDir("lucent-settings-workspace-"),
      );
      const env = makeDesktopEnvironment({
        appDataDir,
        assetsDir: join(appDataDir, "assets"),
        isDev: true,
        platform: "darwin",
        rendererDir: join(appDataDir, "renderer"),
        workspaceDir,
      });
      const settingsLayer = desktopSettingsLayer.pipe(
        Layer.provide(Layer.succeed(DesktopEnvironment, env)),
      );
      const settings = yield* DesktopSettings.pipe(
        Effect.provide(settingsLayer),
      );

      yield* settings.load;
      const before = yield* Effect.promise(() =>
        readFile(env.settingsPath, "utf8"),
      );
      const result = yield* settings
        .updateHotkeys({
          bindings: [{ id: "toggleBank", value: "Mod+Shift+X" }],
        })
        .pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => null,
          }),
        );

      expect(result).toBeInstanceOf(DesktopSettingsError);
      expect(result?.message).toContain("Hotkey is already assigned");
      expect(
        yield* Effect.promise(() => readFile(env.settingsPath, "utf8")),
      ).toBe(before);
    }),
  );

  it.effect("serializes concurrent full-file updates", () =>
    Effect.gen(function* () {
      const appDataDir = yield* Effect.promise(() =>
        makeTempDir("lucent-settings-data-"),
      );
      const workspaceDir = yield* Effect.promise(() =>
        makeTempDir("lucent-settings-workspace-"),
      );
      const env = makeDesktopEnvironment({
        appDataDir,
        assetsDir: join(appDataDir, "assets"),
        isDev: true,
        platform: "darwin",
        rendererDir: join(appDataDir, "renderer"),
        workspaceDir,
      });
      const settingsLayer = desktopSettingsLayer.pipe(
        Layer.provide(Layer.succeed(DesktopEnvironment, env)),
      );
      const settings = yield* DesktopSettings.pipe(
        Effect.provide(settingsLayer),
      );

      yield* settings.load;
      yield* Effect.all(
        [
          settings.updateAppearance({ themeMode: "light" }),
          settings.updatePreferences({ launchMode: "account-manager" }),
        ],
        { concurrency: "unbounded" },
      );

      const current = yield* settings.get;
      const persisted = JSON.parse(
        yield* Effect.promise(() => readFile(env.settingsPath, "utf8")),
      ) as {
        readonly appearance?: { readonly themeMode?: string };
        readonly preferences?: { readonly launchMode?: string };
      };

      expect(current.appearance.themeMode).toBe("light");
      expect(current.preferences.launchMode).toBe("account-manager");
      expect(persisted.appearance?.themeMode).toBe("light");
      expect(persisted.preferences?.launchMode).toBe("account-manager");
    }),
  );
});
