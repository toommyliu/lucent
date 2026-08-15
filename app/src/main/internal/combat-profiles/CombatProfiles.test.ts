import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach } from "vitest";

import {
  COMBAT_PROFILE_LIBRARY_VERSION,
  DEFAULT_COMBAT_PROFILE_ID,
  normalizeCombatProfileLibrary,
  type CombatProfile,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import {
  CombatProfiles,
  layer as desktopCombatProfilesLayer,
} from "./CombatProfiles";

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

const makeHarness = () =>
  Effect.gen(function* () {
    const appDataDir = yield* Effect.promise(() =>
      makeTempDir("lucent-combat-profiles-data-"),
    );
    const workspaceDir = yield* Effect.promise(() =>
      makeTempDir("lucent-combat-profiles-workspace-"),
    );
    const env = DesktopEnvironment.of({
      appDataDir,
      assetsDir: join(appDataDir, "assets"),
      isDev: true,
      platform: "darwin",
      workspaceDir,
    });
    const combatProfilesLayer = desktopCombatProfilesLayer.pipe(
      Layer.provide(Layer.succeed(DesktopEnvironment, env)),
    );
    const combatProfiles = yield* CombatProfiles.pipe(
      Effect.provide(combatProfilesLayer),
    );

    return {
      combatProfiles,
      path: join(env.appDataDir, "combat-profiles.json"),
    };
  });

const testProfile: CombatProfile = {
  id: "archpaladin-farm",
  label: "Farm Rotation",
  className: "ArchPaladin",
  role: "Farm",
  delayMs: 150,
  cooldownMode: "use-if-ready",
  steps: [{ skill: 1, conditions: [], priority: true }],
  messageTriggers: [],
};

describe("CombatProfiles", () => {
  it.effect("deletes saved profiles from the library", () =>
    Effect.gen(function* () {
      const { combatProfiles } = yield* makeHarness();

      yield* combatProfiles.load;
      const saved = yield* combatProfiles.saveProfile(testProfile);
      expect(saved.profiles.at(-1)?.steps[0]?.priority).toBe(true);

      const next = yield* combatProfiles.deleteProfile(testProfile.id);

      expect(
        next.profiles.some((profile) => profile.id === testProfile.id),
      ).toBe(false);
      expect(next.profiles[0]?.id).toBe(DEFAULT_COMBAT_PROFILE_ID);
    }),
  );

  it.effect("loads profile files into canonical data and re-saves them", () =>
    Effect.gen(function* () {
      const { combatProfiles, path } = yield* makeHarness();
      yield* Effect.promise(() =>
        writeFile(
          path,
          JSON.stringify(
            {
              version: COMBAT_PROFILE_LIBRARY_VERSION,
              profiles: [
                {
                  id: "broken-profile",
                  label: "Broken",
                  role: "",
                  delayMs: -1,
                  cooldownMode: "invalid",
                  steps: [{ skill: "bad" }],
                  messageTriggers: [
                    {
                      messageIncludes: " Enrage ",
                      skill: 99,
                      source: "invalid",
                      cooldownMs: 999_999,
                    },
                  ],
                },
              ],
            },
            null,
            2,
          ),
          "utf8",
        ),
      );

      const loaded = yield* combatProfiles.load;
      const saved = yield* Effect.promise(() => readFile(path, "utf8"));

      expect(normalizeCombatProfileLibrary(JSON.parse(saved))).toEqual(loaded);
      expect(loaded.profiles.map((profile) => profile.id)).toEqual([
        DEFAULT_COMBAT_PROFILE_ID,
        "broken-profile",
      ]);
      expect(loaded.profiles[1]).toMatchObject({
        id: "broken-profile",
        label: "Broken",
        role: "Base",
        delayMs: 0,
        cooldownMode: "use-if-ready",
        messageTriggers: [
          {
            messageIncludes: "Enrage",
            skill: 5,
            source: "any",
            cooldownMs: 60_000,
          },
        ],
      });
    }),
  );

  it.effect("does not overwrite files with unsupported future versions", () =>
    Effect.gen(function* () {
      const { combatProfiles, path } = yield* makeHarness();
      const original = `${JSON.stringify(
        {
          version: COMBAT_PROFILE_LIBRARY_VERSION + 1,
          profiles: [testProfile],
        },
        null,
        2,
      )}\n`;
      yield* Effect.promise(() => writeFile(path, original, "utf8"));

      const error = yield* Effect.flip(combatProfiles.load);
      const saved = yield* Effect.promise(() => readFile(path, "utf8"));

      expect(error.operation).toBe("parse");
      expect(saved).toBe(original);
    }),
  );

  it.effect(
    "publishes a successful retry after an invalid file is repaired",
    () =>
      Effect.gen(function* () {
        const { combatProfiles, path } = yield* makeHarness();
        const changes: CombatProfileLibrary[] = [];
        yield* combatProfiles.onChanged((library) => changes.push(library));
        yield* Effect.promise(() =>
          writeFile(
            path,
            JSON.stringify({
              version: COMBAT_PROFILE_LIBRARY_VERSION + 1,
              profiles: [testProfile],
            }),
            "utf8",
          ),
        );

        yield* Effect.flip(combatProfiles.load);
        yield* Effect.promise(() =>
          writeFile(
            path,
            JSON.stringify({
              version: COMBAT_PROFILE_LIBRARY_VERSION,
              profiles: [testProfile],
            }),
            "utf8",
          ),
        );

        const loaded = yield* combatProfiles.load;

        expect(changes).toEqual([loaded]);
      }),
  );
});
