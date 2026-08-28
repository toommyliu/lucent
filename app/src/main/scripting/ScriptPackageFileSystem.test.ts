import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { listRegularFilePaths } from "./ScriptPackageFileSystem";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe("listRegularFilePaths", () => {
  it("applies file limits only when the caller requests one", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "lucent-file-inventory-"));
    directories.push(root);
    await Promise.all(
      ["one.js", "two.js", "three.js"].map((name) =>
        fs.writeFile(join(root, name), "", "utf8"),
      ),
    );

    const paths = await listRegularFilePaths(root);
    expect(paths).toHaveLength(3);
    expect(paths[0]).toEqual({
      absolutePath: join(root, "one.js"),
      relativePath: "one.js",
    });
    await expect(listRegularFilePaths(root, { maxFiles: 2 })).rejects.toThrow(
      "Directory contains more than 2 files",
    );
  });
});
