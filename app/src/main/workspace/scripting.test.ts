import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { readScriptPayload } from "./scripting";

let tempDir: string | undefined;
let scriptsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lucent-scripting-"));
  scriptsDir = join(tempDir, "scripts");
});

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    scriptsDir = undefined;
  }
});

describe("scripts", () => {
  it("rejects scripts outside the workspace scripts directory", async () => {
    if (tempDir === undefined || scriptsDir === undefined) {
      throw new Error("Missing temp directory");
    }

    const outsidePath = join(tempDir, "outside.js");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(outsidePath, "module.exports = 1;\n", "utf8");

    await expect(readScriptPayload(scriptsDir, outsidePath)).rejects.toThrow(
      "Script path must be inside the scripts directory",
    );
  });
});
