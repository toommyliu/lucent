import { describe, expect, it } from "@effect/vitest";

import { formatGameWindowTitle } from "./GameWindowTitle";

describe("formatGameWindowTitle", () => {
  it("shows only a current username when the preference is enabled", () => {
    expect(formatGameWindowTitle("Lucent", true, "PrimaryHero")).toBe(
      "Lucent - PrimaryHero",
    );
    expect(formatGameWindowTitle("Lucent", false, "PrimaryHero")).toBe(
      "Lucent",
    );
    expect(formatGameWindowTitle("Lucent", true, undefined)).toBe("Lucent");
  });
});
