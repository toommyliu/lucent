import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { getFlashPlayerFolder } from "./FlashTrust";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("flash trust paths", () => {
  it("resolves platform-specific Flash Player folders", () => {
    expect(
      getFlashPlayerFolder({
        platform: "darwin",
        env: { HOME: "/Users/example" },
        homeDir: "/fallback",
      }),
    ).toBe(
      join(
        "/Users/example",
        "Library",
        "Preferences",
        "Macromedia",
        "Flash Player",
      ),
    );

    expect(
      getFlashPlayerFolder({
        platform: "linux",
        env: { HOME: "/home/example" },
        homeDir: "/fallback",
      }),
    ).toBe(join("/home/example", ".macromedia", "Flash_Player"));

    expect(
      getFlashPlayerFolder({
        platform: "win32",
        env: {
          APPDATA: "C:\\Users\\example\\AppData\\Roaming",
          USERPROFILE: "C:\\Users\\example",
        },
        homeDir: "/fallback",
        osRelease: "10.0.0",
      }),
    ).toBe(
      join(
        "C:\\Users\\example\\AppData\\Roaming",
        "Macromedia",
        "Flash Player",
      ),
    );
  });
});
