import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterEach } from "vitest";

import {
  DEFAULT_COMBAT_PROFILE_ID,
  type CombatProfile,
} from "../../shared/combat-profiles";
import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../app/DesktopEnvironment";
import {
  DesktopCombatProfiles,
  layer as desktopCombatProfilesLayer,
} from "./DesktopCombatProfiles";

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

const testProfile: CombatProfile = {
  id: "archpaladin-farm",
  label: "Farm Rotation",
  className: "ArchPaladin",
  role: "Farm",
  delayMs: 150,
  cooldownMode: "use-if-ready",
  steps: [{ id: "farm-1", skill: 1, conditions: [] }],
  messageTriggers: [],
};

describe("DesktopCombatProfiles", () => {
  it.effect("deletes saved profiles from the library", () =>
    Effect.gen(function* () {
      const appDataDir = yield* Effect.promise(() =>
        makeTempDir("lucent-combat-profiles-data-"),
      );
      const workspaceDir = yield* Effect.promise(() =>
        makeTempDir("lucent-combat-profiles-workspace-"),
      );
      const env = makeDesktopEnvironment({
        appDataDir,
        assetsDir: join(appDataDir, "assets"),
        isDev: true,
        platform: "darwin",
        rendererDir: join(appDataDir, "renderer"),
        workspaceDir,
      });
      const combatProfilesLayer = desktopCombatProfilesLayer.pipe(
        Layer.provide(Layer.succeed(DesktopEnvironment, env)),
      );
      const combatProfiles = yield* DesktopCombatProfiles.pipe(
        Effect.provide(combatProfilesLayer),
      );

      yield* combatProfiles.load;
      yield* combatProfiles.saveProfile(testProfile);

      const next = yield* combatProfiles.deleteProfile(testProfile.id);

      expect(
        next.profiles.some((profile) => profile.id === testProfile.id),
      ).toBe(false);
      expect(next.profiles[0]?.id).toBe(DEFAULT_COMBAT_PROFILE_ID);
    }),
  );
});
