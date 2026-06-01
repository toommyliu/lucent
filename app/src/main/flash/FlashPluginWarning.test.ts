import { describe, expect, it } from "vitest";
import { makeMissingFlashPluginWarning } from "./FlashPluginWarning";

describe("missing Flash plugin warning", () => {
  it("shows the expected plugin path and supported overrides", () => {
    const warning = makeMissingFlashPluginWarning(
      "/Users/example/Documents/lucent/PepperFlashPlayer.plugin",
    );

    expect(warning.title).toBe("Flash Plugin Missing");
    expect(warning.message).toContain("Pepper Flash plugin");
    expect(warning.detail).toContain(
      "/Users/example/Documents/lucent/PepperFlashPlayer.plugin",
    );
    expect(warning.detail).toContain("LUCENT_HOME");
    expect(warning.detail).toContain("--flash-plugin-path");
  });

  it("handles platforms without a resolved plugin path", () => {
    expect(makeMissingFlashPluginWarning(null).detail).toContain(
      "No platform-specific Pepper Flash plugin path",
    );
  });
});
