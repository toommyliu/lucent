import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vitest";

import { writeTrustFile } from "./FlashTrust";

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

describe("FlashTrust", () => {
  it("writes the Flash trust file", async () => {
    const rootPath = await makeTempDir("lucent-flash-");
    const trustedPath = join(rootPath, "loader.swf");
    const trustFilePath = join(
      rootPath,
      "#Security",
      "FlashPlayerTrust",
      "lucent.cfg",
    );

    writeTrustFile({
      appName: "lucent",
      rootPath,
      trustedPaths: [trustedPath],
    });

    expect(await readFile(trustFilePath, "utf8")).toBe(trustedPath);
  });
});
