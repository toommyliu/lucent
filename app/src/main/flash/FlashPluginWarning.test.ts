import { describe, expect, it } from "@effect/vitest";

import { makeMissingFlashPluginWarning } from "./FlashPluginWarning";

describe("FlashPluginWarning", () => {
  it("includes the expected path and override instructions", () => {
    const warning = makeMissingFlashPluginWarning(
      "/workspace/PepperFlashPlayer.plugin",
    );

    expect(warning.detail).toContain("/workspace/PepperFlashPlayer.plugin");
    expect(warning.detail).toContain("--flash-plugin-path");
  });
});
