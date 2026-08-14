import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";

import {
  initializeAqwFlashPreferenceTemplate,
  seedAqwFlashPreferences,
} from "./FlashPreferences";

const tempDirs = new Set<string>();

const makeTempDir = async (prefix: string): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(path);
  return path;
};

const write = async (path: string, source: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, "utf8");
};

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { force: true, recursive: true })),
  );
  tempDirs.clear();
});

describe("Flash preferences", () => {
  it("seeds only AQW preferences into an existing profile once", async () => {
    const root = await makeTempDir("lucent-flash-preferences-");
    const sourceRootPath = join(root, "source");
    const templateRootPath = join(root, "template");
    const targetRootPath = join(root, "target");
    const sourceDirectory = join(
      sourceRootPath,
      "#SharedObjects",
      "SOURCE",
      "game.aq.com",
    );
    const targetDirectory = join(
      targetRootPath,
      "#SharedObjects",
      "TARGET",
      "game.aq.com",
    );
    await Promise.all([
      write(join(sourceDirectory, "AQLite_Data.sol"), "lite"),
      write(join(sourceDirectory, "AQWUserPref.sol"), "preferences"),
      write(join(sourceDirectory, "AQWChars.ssl"), "characters"),
      write(join(targetDirectory, "AQWUserPref.sol"), "old"),
    ]);

    expect(
      initializeAqwFlashPreferenceTemplate({
        sourceRootPaths: [sourceRootPath],
        templateRootPath,
      }),
    ).toBe(true);
    expect(seedAqwFlashPreferences({ targetRootPath, templateRootPath })).toBe(
      true,
    );
    await expect(
      readFile(join(targetDirectory, "AQLite_Data.sol"), "utf8"),
    ).resolves.toBe("lite");
    await expect(
      readFile(join(targetDirectory, "AQWUserPref.sol"), "utf8"),
    ).resolves.toBe("preferences");
    await expect(
      readFile(join(targetDirectory, "AQWChars.ssl"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await write(join(targetDirectory, "AQWUserPref.sol"), "changed");
    expect(seedAqwFlashPreferences({ targetRootPath, templateRootPath })).toBe(
      false,
    );
    await expect(
      readFile(join(targetDirectory, "AQWUserPref.sol"), "utf8"),
    ).resolves.toBe("changed");
  });

  it("reuses the source shared-object root for a fresh profile", async () => {
    const root = await makeTempDir("lucent-flash-preferences-");
    const sourceRootPath = join(root, "source");
    const templateRootPath = join(root, "template");
    const targetRootPath = join(root, "target");
    const sourceFile = join(
      sourceRootPath,
      "#SharedObjects",
      "SOURCE",
      "game.aq.com",
      "AQWUserPref.sol",
    );
    await write(sourceFile, "preferences");

    expect(
      initializeAqwFlashPreferenceTemplate({
        sourceRootPaths: [sourceRootPath],
        templateRootPath,
      }),
    ).toBe(true);
    expect(seedAqwFlashPreferences({ targetRootPath, templateRootPath })).toBe(
      true,
    );
    await expect(
      readFile(
        join(
          targetRootPath,
          "#SharedObjects",
          "SOURCE",
          "game.aq.com",
          "AQWUserPref.sol",
        ),
        "utf8",
      ),
    ).resolves.toBe("preferences");
  });
});
