import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";
import { Effect, Layer } from "effect";

import {
  findMissingRequiredScriptInputs,
  type ScriptInputsDefinition,
} from "@lucent/core/scriptInputs";
import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../app/DesktopEnvironment";
import {
  ScriptInputRepository,
  layer as scriptInputRepositoryLayer,
} from "./ScriptInputRepository";

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

const definition: ScriptInputsDefinition = {
  id: "repository-test",
  fields: [
    {
      key: "target",
      type: "string",
      label: "Target",
      required: true,
    },
    {
      key: "count",
      type: "number",
      label: "Count",
      default: 3,
    },
    {
      key: "enabled",
      type: "boolean",
      label: "Enabled",
      default: false,
    },
    {
      key: "server",
      type: "select",
      label: "Server",
      options: ["Artix", "Yorumi"],
      default: "Artix",
    },
  ],
};

const makeRepository = () =>
  Effect.gen(function* () {
    const appDataDir = yield* Effect.promise(() =>
      makeTempDir("lucent-script-inputs-data-"),
    );
    const workspaceDir = yield* Effect.promise(() =>
      makeTempDir("lucent-script-inputs-workspace-"),
    );
    const env = makeDesktopEnvironment({
      appDataDir,
      assetsDir: join(appDataDir, "assets"),
      isDev: true,
      platform: "darwin",
      rendererDir: join(appDataDir, "renderer"),
      workspaceDir,
    });
    const repository = yield* ScriptInputRepository.pipe(
      Effect.provide(
        scriptInputRepositoryLayer.pipe(
          Layer.provide(Layer.succeed(DesktopEnvironment, env)),
        ),
      ),
    );
    return { env, repository };
  });

describe("ScriptInputRepository", () => {
  it.effect("returns default values when no saved values exist", () =>
    Effect.gen(function* () {
      const { repository } = yield* makeRepository();

      const values = yield* repository.getValues(definition);

      expect(values).toEqual({
        count: 3,
        enabled: false,
        server: "Artix",
      });
      expect(findMissingRequiredScriptInputs(definition, values)).toEqual([
        "target",
      ]);
    }),
  );

  it.effect("normalizes saved values before persisting", () =>
    Effect.gen(function* () {
      const { env, repository } = yield* makeRepository();

      const values = yield* repository.saveValues(definition, {
        count: Number.NaN,
        enabled: true,
        server: "Missing",
        target: "chaos",
      });
      const persisted = JSON.parse(
        yield* Effect.promise(() =>
          readFile(env.appDataPath("script-inputs.json"), "utf8"),
        ),
      ) as Record<string, unknown>;

      expect(values).toEqual({
        count: 3,
        enabled: true,
        server: "Artix",
        target: "chaos",
      });
      expect(persisted).toEqual({
        "repository-test": values,
      });
    }),
  );
});
