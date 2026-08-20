import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";

import {
  activateManagedGamePartitionProfile,
  cleanupStaleGamePartitionProfiles,
  defaultGamePartition,
  managedGamePartition,
  resolveGamePartitionProfilePath,
  retireManagedGamePartitionProfile,
} from "./ElectronGamePartitions";

const tempDirs = new Set<string>();

const makeTempDir = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "lucent-game-partitions-"));
  tempDirs.add(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { force: true, recursive: true })),
  );
  tempDirs.clear();
});

describe("Electron game partitions", () => {
  it("retires managed profiles without exposing account names", async () => {
    const appDataDir = await makeTempDir();
    const partition = managedGamePartition("Alice");
    const profilePath = resolveGamePartitionProfilePath(appDataDir, partition);
    await mkdir(profilePath, { recursive: true });

    expect(partition).not.toContain("Alice");
    expect(retireManagedGamePartitionProfile(appDataDir, "alice")).toBe(true);
    await expect(
      readFile(join(profilePath, ".lucent-retired"), "utf8"),
    ).resolves.toBe("1\n");

    activateManagedGamePartitionProfile(profilePath);
    await expect(
      readFile(join(profilePath, ".lucent-retired"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans retired and dead profiles without touching live data", async () => {
    const appDataDir = await makeTempDir();
    const partitionsPath = join(appDataDir, "Partitions");
    const retiredManaged = basename(
      resolveGamePartitionProfilePath(
        appDataDir,
        managedGamePartition("Retired"),
      ),
    );
    const activeManaged = basename(
      resolveGamePartitionProfilePath(
        appDataDir,
        managedGamePartition("Active"),
      ),
    );
    const removable = [
      `lucent-game-temporary-10-${"a".repeat(24)}`,
      retiredManaged,
    ];
    const retained = [
      `lucent-game-temporary-20-${"b".repeat(24)}`,
      basename(
        resolveGamePartitionProfilePath(appDataDir, defaultGamePartition),
      ),
      activeManaged,
      "unrelated",
    ];
    await Promise.all(
      [...removable, ...retained].map((name) =>
        mkdir(join(partitionsPath, name), { recursive: true }),
      ),
    );
    await writeFile(
      join(partitionsPath, retiredManaged, ".lucent-retired"),
      "1\n",
      "utf8",
    );

    const result = cleanupStaleGamePartitionProfiles(appDataDir, {
      isProcessAlive: (processId) => processId === 20,
    });

    expect(result.failedPaths).toEqual([]);
    expect(
      result.removedPaths.map((path) => basename(path)).toSorted(),
    ).toEqual(removable.toSorted());
    for (const name of retained) {
      expect((await stat(join(partitionsPath, name))).isDirectory()).toBe(true);
    }
  });
});
