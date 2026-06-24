import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
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
  DesktopData,
  DesktopDataError,
  layer as desktopDataLayer,
} from "./DesktopData";

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

describe("DesktopData", () => {
  it.effect(
    "loads defaults, fails invalid settings JSON, and writes JSON atomically",
    () =>
      Effect.gen(function* () {
        const appDataDir = yield* Effect.promise(() =>
          makeTempDir("lucent-data-"),
        );
        const workspaceDir = yield* Effect.promise(() =>
          makeTempDir("lucent-workspace-"),
        );
        const env = makeDesktopEnvironment({
          appDataDir,
          assetsDir: join(appDataDir, "assets"),
          isDev: true,
          platform: "darwin",
          rendererDir: join(appDataDir, "renderer"),
          workspaceDir,
        });
        const layer = desktopDataLayer.pipe(
          Layer.provide(Layer.succeed(DesktopEnvironment, env)),
        );
        const data = yield* DesktopData.pipe(Effect.provide(layer));

        const defaults = yield* data.loadSettings;
        expect(defaults).toEqual(DEFAULT_APP_SETTINGS);

        yield* Effect.promise(() => writeFile(env.settingsPath, "{", "utf8"));
        const parseError = yield* data.loadSettings.pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => null,
          }),
        );
        expect(parseError).toBeInstanceOf(DesktopDataError);
        expect(parseError?.operation).toBe("parse");

        yield* data.writeJson(join(appDataDir, "atomic.json"), { ok: true });
        const atomicSource = yield* Effect.promise(() =>
          readFile(join(appDataDir, "atomic.json"), "utf8"),
        );
        expect(atomicSource).toBe('{\n  "ok": true\n}\n');
        const appDataSiblings = yield* Effect.promise(() =>
          readdir(appDataDir),
        );
        expect(appDataSiblings.some((name) => name.endsWith(".tmp"))).toBe(
          false,
        );
      }),
  );
});
