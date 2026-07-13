import { describe, expect, it } from "vitest";

import { parseAllowedUpdateReleaseUrl } from "./UpdateReleaseOpenPolicy";

describe("parseAllowedUpdateReleaseUrl", () => {
  it("allows only Lucent GitHub release pages", () => {
    expect(
      parseAllowedUpdateReleaseUrl(
        "https://github.com/toommyliu/lucent/releases/tag/v1.2.3",
      )?.href,
    ).toBe("https://github.com/toommyliu/lucent/releases/tag/v1.2.3");
    expect(
      parseAllowedUpdateReleaseUrl(
        "https://github.com/toommyliu/other/releases/tag/v1.2.3",
      ),
    ).toBeNull();
    expect(
      parseAllowedUpdateReleaseUrl(
        "https://github.com.evil.test/toommyliu/lucent/releases/tag/v1.2.3",
      ),
    ).toBeNull();
    expect(
      parseAllowedUpdateReleaseUrl(
        "https://github.com/toommyliu/lucent/issues/1",
      ),
    ).toBeNull();
  });
});
